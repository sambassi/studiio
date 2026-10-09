-- ═══════════════════════════════════════════════════════════════════════════
-- AVATARS : IDENTITÉS + VERSIONS
--
-- Incident du 2026-10-09 : changer la source d'un avatar ÉCRASAIT la ligne
-- active (version+1, fournisseur et validation remis à zéro) avant que le
-- remplaçant existe. Un refus du fournisseur a coupé le jumeau v3.
--
-- Modèle :
--   user_avatars    = l'IDENTITÉ (« Bassi principal »). Ses colonnes de
--                     version (version, status, provider_avatar_id,
--                     validated_at, source_object_key…) restent un MIROIR de
--                     la version ACTIVE : tout le code qui lit déjà l'avatar
--                     actif continue de lire la bonne valeur.
--   avatar_versions = TOUTES les versions d'une identité : active,
--                     candidate (en préparation), en échec, historique.
--   user_avatars.active_version_id
--                   = la version utilisée. Ne change QUE par
--                     `activer_version_avatar` (transaction, compare-and-set).
--
-- RÈGLE : une version candidate n'écrit JAMAIS dans le miroir. Seule la
-- bascule explicite (« Utiliser cette version ») le fait.
--
-- ADDITIVE : aucune colonne supprimée, aucune ligne effacée. Le code actuel
-- continue de fonctionner sur cette base (il lit le miroir).
-- Rejouable (`if not exists`, backfill idempotent).
--
-- APRÈS :  docker kill -s SIGUSR1 studiio-postgrest
-- ROLLBACK : migrations/rollback/2026-10-10-avatar-identites-versions.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- 1. Les versions ────────────────────────────────────────────────────────
create table if not exists public.avatar_versions (
  id uuid primary key default gen_random_uuid(),
  user_avatar_id uuid not null references public.user_avatars(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  version integer not null check (version >= 1),
  provider text not null default 'heygen',
  avatar_type text not null default 'photo',
  status text not null,
  provider_avatar_id text,
  provider_asset_id text,
  -- La source ENVOYÉE au fournisseur (recadrée / améliorée le cas échéant).
  source_object_key text,
  -- L'ORIGINAL importé ou enregistré, jamais modifié ni supprimé au traitement.
  original_source_object_key text,
  training_error text,
  validated_at timestamptz,
  consent_text text,
  consent_version text,
  consent_at timestamptz,
  subject_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  -- « Abandonner » une candidate : conservée pour l'historique, jamais effacée.
  abandoned_at timestamptz,
  unique (user_avatar_id, version)
);
create index if not exists avatar_versions_user_idx on public.avatar_versions (user_id);
create index if not exists avatar_versions_avatar_idx on public.avatar_versions (user_avatar_id, version desc);

-- 2. L'identité ──────────────────────────────────────────────────────────
alter table public.user_avatars
  add column if not exists active_version_id uuid references public.avatar_versions(id) on delete set null,
  add column if not exists is_default boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

-- Plusieurs identités par compte : l'ancien « un seul avatar vivant » tombe,
-- remplacé par « un seul avatar PAR DÉFAUT ». Ce nouvel index garde la
-- protection contre deux PREMIÈRES créations simultanées : le code crée la
-- première identité d'un compte avec `is_default = true`, donc la seconde
-- insertion concurrente échoue en 23505, comme avant. Une identité
-- SUPPLÉMENTAIRE (« Créer un nouvel avatar ») n'est jamais créée par défaut.
drop index if exists public.user_avatars_one_active_per_user_uidx;
create unique index if not exists user_avatars_un_defaut_par_compte_uidx
  on public.user_avatars (user_id)
  where is_default and deleted_at is null;

-- 3. Traçabilité des rendus ──────────────────────────────────────────────
alter table public.avatar_generations
  add column if not exists avatar_version_id uuid references public.avatar_versions(id) on delete set null,
  add column if not exists engine text;

-- 4. Autopilote : l'identité LOGIQUE choisie (null = avatar par défaut) ──
alter table public.autopilot_config
  add column if not exists avatar_id uuid references public.user_avatars(id) on delete set null;

-- 5. Reprise de l'existant ───────────────────────────────────────────────
-- Chaque identité vivante reçoit SA version actuelle comme ligne de version.
insert into public.avatar_versions (
  user_avatar_id, user_id, version, provider, avatar_type, status,
  provider_avatar_id, provider_asset_id, source_object_key, original_source_object_key,
  training_error, validated_at, consent_text, consent_version, consent_at, subject_type,
  created_at, activated_at
)
select a.id, a.user_id, a.version, coalesce(a.provider, 'heygen'), coalesce(a.avatar_type, 'photo'), a.status,
       a.provider_avatar_id, a.provider_asset_id, a.source_object_key, a.source_object_key,
       a.training_error, a.validated_at, a.consent_text, a.consent_version, a.consent_at, a.subject_type,
       coalesce(a.consent_at, a.created_at),
       case when a.provider_avatar_id is not null and a.validated_at is not null
             and a.status in ('completed', 'ready', 'success') then now() end
from public.user_avatars a
where a.deleted_at is null
  and not exists (
    select 1 from public.avatar_versions v
    where v.user_avatar_id = a.id and v.version = a.version
  );

-- La version actuelle devient ACTIVE seulement si elle est réellement
-- utilisable (fournisseur prêt + validée) — même règle que `etatAvatar`.
update public.user_avatars a
   set active_version_id = v.id
  from public.avatar_versions v
 where v.user_avatar_id = a.id
   and v.version = a.version
   and a.deleted_at is null
   and a.active_version_id is null
   and a.provider_avatar_id is not null
   and a.validated_at is not null
   and a.status in ('completed', 'ready', 'success');

-- Aujourd'hui un compte n'a qu'une identité vivante : elle devient le défaut.
update public.user_avatars a
   set is_default = true
 where a.deleted_at is null
   and not a.is_default
   and not exists (
     select 1 from public.user_avatars b
     where b.user_id = a.user_id and b.deleted_at is null and b.is_default
   )
   and a.id = (
     select c.id from public.user_avatars c
     where c.user_id = a.user_id and c.deleted_at is null
     order by c.created_at asc limit 1
   );

-- Les générations existantes pointent vers la version reprise, quand elle existe.
update public.avatar_generations g
   set avatar_version_id = v.id
  from public.avatar_versions v
 where g.avatar_version_id is null
   and v.user_avatar_id = g.user_avatar_id
   and v.version = g.avatar_version;

-- 6. Bascule ATOMIQUE de version ─────────────────────────────────────────
-- Seule écriture autorisée sur le miroir. Compare-and-set sur la version
-- active attendue : deux bascules concurrentes ne peuvent pas se croiser.
-- Revenir à l'ancienne version = rappeler cette fonction avec elle.
create or replace function public.activer_version_avatar(
  p_user_id uuid,
  p_avatar_id uuid,
  p_version_id uuid,
  p_active_attendue uuid
)
returns table (ok boolean, motif text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  a public.user_avatars%rowtype;
  v public.avatar_versions%rowtype;
begin
  select * into a from public.user_avatars
   where id = p_avatar_id and user_id = p_user_id and deleted_at is null
   for update;
  if not found then return query select false, 'introuvable'; return; end if;
  if a.active_version_id is distinct from p_active_attendue then
    return query select false, 'concurrent'; return;
  end if;

  select * into v from public.avatar_versions
   where id = p_version_id and user_avatar_id = p_avatar_id and user_id = p_user_id
     and abandoned_at is null
   for update;
  if not found then return query select false, 'version_introuvable'; return; end if;
  if v.provider_avatar_id is null or v.validated_at is null
     or v.status not in ('completed', 'ready', 'success') then
    return query select false, 'version_non_prete'; return;
  end if;

  update public.user_avatars
     set active_version_id = v.id,
         version = v.version,
         status = v.status,
         provider = v.provider,
         avatar_type = v.avatar_type,
         provider_avatar_id = v.provider_avatar_id,
         provider_asset_id = v.provider_asset_id,
         source_object_key = v.source_object_key,
         source_url = null,
         training_error = null,
         validated_at = v.validated_at,
         updated_at = now()
   where id = a.id;
  update public.avatar_versions set activated_at = now(), updated_at = now() where id = v.id;
  return query select true, null::text;
end;
$$;

-- 7. Avatar PAR DÉFAUT du compte (deux écritures, une transaction) ────────
create or replace function public.definir_avatar_par_defaut(
  p_user_id uuid,
  p_avatar_id uuid
)
returns table (ok boolean, motif text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform 1 from public.user_avatars
   where id = p_avatar_id and user_id = p_user_id and deleted_at is null
   for update;
  if not found then return query select false, 'introuvable'; return; end if;
  update public.user_avatars set is_default = false, updated_at = now()
   where user_id = p_user_id and is_default and id <> p_avatar_id;
  update public.user_avatars set is_default = true, updated_at = now()
   where id = p_avatar_id;
  return query select true, null::text;
end;
$$;

-- 8. Droits ──────────────────────────────────────────────────────────────
-- AUCUN droit ouvert : `avatar_versions` contient des clés de sources
-- biométriques et des identifiants fournisseur. En production, PostgREST se
-- connecte en `studiio`, propriétaire (rôle des migrations) : il n'a besoin
-- d'aucun grant. On nomme quand même les rôles serveur s'ils existent, pour
-- le jour où ils ne seraient plus propriétaires — jamais `public`, `anon`
-- ou `authenticated` (même convention que `2026-09-14-lut-assets.sql`).
revoke all on table public.avatar_versions from public;
revoke all on function public.activer_version_avatar(uuid, uuid, uuid, uuid) from public;
revoke all on function public.definir_avatar_par_defaut(uuid, uuid) from public;
do $$
declare r text;
begin
  foreach r in array array['studiio', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant select, insert, update, delete on table public.avatar_versions to %I', r);
      execute format('grant execute on function public.activer_version_avatar(uuid, uuid, uuid, uuid) to %I', r);
      execute format('grant execute on function public.definir_avatar_par_defaut(uuid, uuid) to %I', r);
    end if;
  end loop;
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- CONTRÔLE (lecture) — à lancer après :
--   select a.id, a.version, a.status, a.is_default,
--          v.version as version_active, v.status as statut_version
--   from user_avatars a left join avatar_versions v on v.id = a.active_version_id
--   where a.deleted_at is null;
-- Attendu pour l'admin : version 3, completed, is_default = true,
-- version_active = 3.
-- ═══════════════════════════════════════════════════════════════════════════
