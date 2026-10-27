cat > /tmp/migration-532.sh <<'SCRIPT'
#!/usr/bin/env bash
# #532 EN PRODUCTION : migration identites/versions d'avatar
# (+ bail de creation), AVANT tout deploiement du code #532.
#   A. gardes en lecture seule (etat #533, v3, non appliquee)
#   B. sauvegarde horodatee, verifiee
#   C. migration (une transaction, lock_timeout 15 s)
#   D. rechargement du cache PostgREST (SIGUSR1)
#   E. controles apres ; sinon ROLLBACK automatique
# Aucun deploiement, aucun appel fournisseur, aucun Coolify.
# Aucun conteneur recree. Aucun secret affiche.
set -uo pipefail
umask 077
ATTENDU_SHA=9bc20e0014289ebf
S=$(grep -v '^ATTENDU_SHA=' "$0" | sha256sum | cut -c1-16)
[ "$S" = "$ATTENDU_SHA" ] || {
  echo "STOP: script altere ($S)"; exit 1; }
echo "INTEGRITE_SCRIPT=ok"
EMP_V3=42b0cfe09ca64a2b
MAIL_V3=contact.artboost@gmail.com
APP_UUID=l142u3oa8w38xz1zcu6t5lnl
PG=studiio-postgrest
SAUV_RACINE=/root/backups
SHA_MIG=0a24847784d952ebdd670628b142b1b72c888b35999715e8622ca43393f23e8e
SHA_RB=62bac35d50fe3818e2eae7f71e411eb921ed8f2d9cc3a58707abc0cb948baa50
TS=$(date -u +%Y%m%dT%H%M%SZ)
SAUV=$SAUV_RACINE/prod-532-$TS
T=$(mktemp -d /root/.m532.XXXXXX)
trap 'rm -rf "$T"' EXIT
stop() { echo "STOP: $*"; echo "PRODUCTION_MODIFIEE=non"; exit 1; }
DB=$(docker ps --filter name=qhhaglete0jnw1ixrjer3ho8 \
  --format '{{.Names}}' | head -1)
app_ctr() {
  docker ps --filter "name=$APP_UUID" \
    --format '{{.Names}}' | head -1
}
APP=$(app_ctr)
[ -n "$DB" ] && [ -n "$APP" ] || stop "db/app introuvables"
echo "CONTENEUR_DB=$DB"
echo "CONTENEUR_APP=$APP"
sqlw() {
  docker exec -i "$DB" psql -U studiio -d studiio \
    -At -F ' ' -v ON_ERROR_STOP=1 "$@"
}
KO=""
ko() { KO="$KO $1"; echo "KO $1"; }

# ── SQL de la PR (main 7590384), embarques et verifies ──
cat > "$T/migration.sql" <<'MIGSQL'
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

-- 8. UNE création de version / d'avatar à la fois PAR COMPTE ───────────────
-- Un BAIL en base, valable pour TOUS les conteneurs (un déploiement progressif
-- en fait tourner deux) : sans lui, deux requêtes simultanées passeraient les
-- contrôles « emplacement libre / plafond / une candidate » et paieraient
-- deux fois le fournisseur. Pris et rendu chacun en UNE instruction
-- (transaction de quelques millisecondes) : aucune transaction n'est tenue
-- pendant l'appel au fournisseur. Pas d'advisory lock de session : PostgREST
-- partage ses connexions entre requêtes. Le bail expire seul (conteneur
-- tué en plein appel) ; seul le détenteur de son jeton peut le rendre.
create table if not exists public.avatar_verrous_creation (
  user_id uuid primary key references public.users(id) on delete cascade,
  jeton uuid not null,
  expire_le timestamptz not null
);

-- Vrai = bail pris. Une ligne vivante d'un autre jeton = faux. Deux appels
-- simultanés : le second attend le premier sur la clé primaire, puis voit
-- un bail vivant — un seul gagne.
create or replace function public.prendre_verrou_creation_avatar(
  p_user_id uuid,
  p_jeton uuid,
  p_secondes integer
)
returns boolean
language sql
set search_path = pg_catalog, public
as $$
  with pris as (
    insert into public.avatar_verrous_creation as v (user_id, jeton, expire_le)
    values (p_user_id, p_jeton,
            now() + make_interval(secs => greatest(1, least(coalesce(p_secondes, 600), 900))))
    on conflict (user_id) do update
      set jeton = excluded.jeton, expire_le = excluded.expire_le
      where v.expire_le < now()
    returning 1
  )
  select exists (select 1 from pris);
$$;

create or replace function public.liberer_verrou_creation_avatar(
  p_user_id uuid,
  p_jeton uuid
)
returns boolean
language sql
set search_path = pg_catalog, public
as $$
  with rendu as (
    delete from public.avatar_verrous_creation
     where user_id = p_user_id and jeton = p_jeton
    returning 1
  )
  select exists (select 1 from rendu);
$$;

-- 9. Droits ──────────────────────────────────────────────────────────────
-- AUCUN droit ouvert : `avatar_versions` contient des clés de sources
-- biométriques et des identifiants fournisseur. Depuis #533 (appliquée le
-- 2026-10-09), PostgREST se connecte en `authenticator`, qui ne fait que
-- prendre `web_anon` (anonyme : AUCUN droit ici) ou `service_role` (le
-- backend : droits ci-dessous). `studiio` reste le propriétaire, rôle des
-- migrations. Jamais `public`, `anon`, `authenticated` ni `web_anon`.
revoke all on table public.avatar_versions from public;
revoke all on table public.avatar_verrous_creation from public;
revoke all on function public.activer_version_avatar(uuid, uuid, uuid, uuid) from public;
revoke all on function public.definir_avatar_par_defaut(uuid, uuid) from public;
revoke all on function public.prendre_verrou_creation_avatar(uuid, uuid, integer) from public;
revoke all on function public.liberer_verrou_creation_avatar(uuid, uuid) from public;
do $$
declare r text;
begin
  foreach r in array array['studiio', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant select, insert, update, delete on table public.avatar_versions to %I', r);
      execute format('grant select, insert, update, delete on table public.avatar_verrous_creation to %I', r);
      execute format('grant execute on function public.activer_version_avatar(uuid, uuid, uuid, uuid) to %I', r);
      execute format('grant execute on function public.definir_avatar_par_defaut(uuid, uuid) to %I', r);
      execute format('grant execute on function public.prendre_verrou_creation_avatar(uuid, uuid, integer) to %I', r);
      execute format('grant execute on function public.liberer_verrou_creation_avatar(uuid, uuid) to %I', r);
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
MIGSQL
cat > "$T/rollback.sql" <<'RBSQL'
-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de `migrations/2026-10-10-avatar-identites-versions.sql`
--
-- Rangé dans `migrations/rollback/` : aucun outil qui applique
-- `migrations/*.sql` ne peut le jouer par erreur.
--
-- ORDRE : d'abord redéployer un commit qui n'utilise PAS ces tables /
-- fonctions (main d'avant la PR), PUIS jouer ce fichier, PUIS
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- Le miroir (`user_avatars.version`, `provider_avatar_id`…) n'a jamais cessé
-- d'être la vérité de la version active : l'ancien code repart tel quel.
--
-- ⚠️ PRÉ-CONDITION : un seul avatar VIVANT par compte. L'index d'origine est
-- recréé ; s'il échoue, des identités supplémentaires ont été créées — les
-- archiver (deleted_at) une par une, en connaissance de cause, avant de rejouer.
--
-- Ce qui est PERDU : l'historique des versions (avatar_versions) et le lien
-- version des générations. Ce qui est GARDÉ : toutes les lignes
-- user_avatars, avatar_generations, autopilot_config, et les fichiers.
-- ═══════════════════════════════════════════════════════════════════════════

begin;
drop function if exists public.prendre_verrou_creation_avatar(uuid, uuid, integer);
drop function if exists public.liberer_verrou_creation_avatar(uuid, uuid);
drop table if exists public.avatar_verrous_creation;
drop function if exists public.activer_version_avatar(uuid, uuid, uuid, uuid);
drop function if exists public.definir_avatar_par_defaut(uuid, uuid);
alter table public.autopilot_config drop column if exists avatar_id;
alter table public.avatar_generations drop column if exists avatar_version_id;
alter table public.avatar_generations drop column if exists engine;
drop index if exists public.user_avatars_un_defaut_par_compte_uidx;
alter table public.user_avatars drop column if exists active_version_id;
alter table public.user_avatars drop column if exists is_default;
alter table public.user_avatars drop column if exists updated_at;
drop table if exists public.avatar_versions;
create unique index if not exists user_avatars_one_active_per_user_uidx
  on public.user_avatars (user_id)
  where deleted_at is null;
commit;
RBSQL
H1=$(sha256sum "$T/migration.sql" | cut -d' ' -f1)
H2=$(sha256sum "$T/rollback.sql" | cut -d' ' -f1)
[ "$H1" = "$SHA_MIG" ] || stop "migration embarquee alteree"
[ "$H2" = "$SHA_RB" ] || stop "rollback embarque altere"
echo "SQL_EMBARQUES=conformes a main (migration+rollback)"

controle() {
local ATT_LOGIN=$1 Z NZ E L AR S i R RC AN APP
local NT RPC_RESULT V VV RE VS VP EMP
KO=""
APP=$(app_ctr)
echo "=== 2. CONTROLES Z (les 13) ==="
cat > /tmp/valide-z.sql <<'SQL'
select 'Z roles_presents', (select count(*) from pg_roles
  where rolname in ('authenticator','web_anon',
  'service_role')) = 3;
select 'Z aucun_superuser', not exists (select 1
  from pg_roles where rolsuper and rolname in
  ('authenticator','web_anon','service_role'));
select 'Z authenticator_noinherit', coalesce((select
  not rolinherit from pg_roles
  where rolname = 'authenticator'), false);
select 'Z authenticator_deux_roles', not exists (
  select 1 from pg_auth_members m
  join pg_roles g on g.oid = m.roleid
  join pg_roles u on u.oid = m.member
  where u.rolname = 'authenticator'
    and g.rolname not in ('web_anon','service_role'));
select 'Z web_anon_sans_usage', not has_schema_privilege(
  'web_anon', 'public', 'USAGE');
select 'Z aucun_grant_public_tables', not exists (
  select 1 from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
  where n.nspname = 'public' and a.grantee = 0);
select 'Z service_role_dml', not exists (
  select 1 from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p')
  and not (has_table_privilege('service_role', c.oid,
    'SELECT') and has_table_privilege('service_role',
    c.oid, 'INSERT') and has_table_privilege(
    'service_role', c.oid, 'UPDATE')
    and has_table_privilege('service_role', c.oid,
    'DELETE')));
select 'Z service_role_execute', not exists (
  select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and not
  has_function_privilege('service_role', p.oid,
  'EXECUTE'));
select 'Z service_role_bypassrls', (select rolbypassrls
  from pg_roles where rolname = 'service_role');
select 'Z service_role_membre_de_rien', not exists (
  select 1 from pg_auth_members m
  join pg_roles u on u.oid = m.member
  where u.rolname = 'service_role');
select 'Z herites_neutralises', not exists (
  select 1 from pg_roles
  where rolname in ('anon','authenticated')
  and (rolcanlogin or rolsuper or rolbypassrls))
  and not exists (select 1 from pg_auth_members m
  join pg_roles u on u.oid = m.member
  where u.rolname in ('anon','authenticated'));
select 'Z secdef_search_path', not exists (
  select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
  and not exists (select 1 from unnest(coalesce(
  p.proconfig, '{}')) c where c like 'search_path=%'));
select 'Z secdef_ferme_a_public', not exists (
  select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl,
  acldefault('f', p.proowner))) a
  where n.nspname = 'public' and p.prosecdef
  and a.grantee = 0);
SQL
if ! Z=$(sqlw < /tmp/valide-z.sql 2>&1); then
  ko "z_erreur_sql"
fi
printf '%s\n' "$Z"
NZ=$(printf '%s\n' "$Z" | grep -c '^Z .* t$')
echo "Z_EXECUTES_ET_OK=$NZ/13"
[ "$NZ" = 13 ] || ko "z_${NZ}_sur_13"
echo "=== POSTGREST (login $ATT_LOGIN, anon web_anon) ==="
E=$(docker inspect "$PG" \
  --format '{{range .Config.Env}}{{println .}}{{end}}')
L=$(printf '%s\n' "$E" \
  | sed -nE 's#^PGRST_DB_URI=[a-z]+://([^:@/]+).*#\1#p')
AR=$(printf '%s\n' "$E" \
  | sed -n 's/^PGRST_DB_ANON_ROLE=//p')
echo "PGRST_LOGIN=$L"
echo "PGRST_ANON_ROLE=$AR"
[ "$L" = "$ATT_LOGIN" ] || ko "login_$L"
[ "$AR" = web_anon ] || ko "anon_$AR"
echo "=== 4. BACKEND PAR LE CHEMIN DE L'APP ==="
# PostgREST vient de redemarrer : jusqu'a 60 s pour
# repondre, sans jamais conclure trop tot.
for i in $(seq 1 12); do
  S=$(docker exec "$APP" node -e '
const k = process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const u = (process.env.SUPABASE_URL || "")
  .replace(/\/$/, "") + "/rest/v1/users?limit=0";
fetch(u, { headers: { apikey: k,
  Authorization: "Bearer " + k } })
  .then((r) => console.log(r.status))
  .catch(() => console.log(0));' 2>/dev/null)
  [ "$S" = 200 ] && break
  sleep 5
done
echo "POSTGREST_PRET=$S"
R=$(docker exec "$APP" node -e '
const k = process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const u = (process.env.SUPABASE_URL || "")
  .replace(/\/$/, "") + "/rest/v1";
let role = "illisible";
try {
  role = JSON.parse(Buffer.from(k.split(".")[1],
    "base64url")).role;
} catch {}
const T = ["users","scheduled_posts","videos",
  "user_avatars","avatar_generations",
  "social_accounts","app_settings",
  "credit_transactions","autopilot_config",
  "autopilot_jumeau_attente","plans","credit_packs",
  "subscriptions","user_settings",
  "user_voices","rendus","render_jobs",
  "publishing_history","zernio_accounts"];
const H = { apikey: k, Authorization: "Bearer " + k };
(async () => {
  console.log("ROLE_CLE " + role);
  const a = await fetch(u + "/users?select=id&limit=0");
  console.log("ANONYME " + a.status);
  for (const t of T) {
    const r = await fetch(u + "/" + t
      + "?select=*&limit=0", { headers: H });
    console.log("TABLE " + t + " " + r.status);
  }
})().catch((e) => console.log("ERREUR " + e.message));
' 2>&1) || ko "sonde_node"
RC=$(printf '%s\n' "$R" | sed -n 's/^ROLE_CLE //p')
AN=$(printf '%s\n' "$R" | sed -n 's/^ANONYME //p')
echo "SERVICE_KEY_ROLE=$RC"
echo "ANONYME=$AN (attendu 401)"
[ "$RC" = service_role ] || ko "cle_$RC"
[ "$AN" = 401 ] || ko "anonyme_$AN"
printf '%s\n' "$R" | grep -q '^ERREUR' \
  && ko "erreur_reseau"
NT=$(printf '%s\n' "$R" | grep -c '^TABLE .* 200$')
echo "TABLES_200=$NT/19"
[ "$NT" = 19 ] || { ko "tables_${NT}_sur_19"
  printf '%s\n' "$R" | grep '^TABLE' | grep -v ' 200$'; }
echo "=== 5. RPC SERVEUR (10) ==="
if ! RPC_RESULT=$(sqlw <<'SQL' 2>&1
select r, count(*) filter (where
  has_function_privilege(r, p.oid, 'execute')),
  count(*)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace,
unnest(array['studiio','service_role']) r
where n.nspname = 'public'
  and p.proname in ('debiter_credits',
   'debiter_credits_operation','confirmer_rendu',
   'confirmer_rendu_sans_debit','clore_rendu',
   'lut_assets_ajouter','crediter_credits_stripe',
   'stripe_event_claim','stripe_event_complete',
   'stripe_event_fail')
group by r order by r;
SQL
); then ko "rpc_erreur_sql"; fi
printf '%s\n' "$RPC_RESULT" | sed 's/^/RPC /'
printf '%s\n' "$RPC_RESULT" | while read -r r x t; do
  [ "$x" = "$t" ] && [ "${t:-0}" -ge 10 ] || echo NOK
done | grep -q NOK && ko "rpc_incomplet"
[ "$(printf '%s\n' "$RPC_RESULT" | grep -c .)" = 2 ] \
  || ko "rpc_illisible"
echo "=== 6. JUMEAU V3 ==="
if ! V=$(sqlw <<'SQL' 2>&1
select a.version || ' ' || a.status || ' '
  || coalesce(a.provider_avatar_id, '')
from user_avatars a join users u on u.id = a.user_id
where u.email = 'contact.artboost@gmail.com'
  and a.deleted_at is null
order by a.created_at limit 1;
SQL
); then ko "v3_erreur_sql"; V=""; fi
VV=${V%% *}; RE=${V#* }; VS=${RE%% *}; VP=${RE#* }
EMP=$(printf '%s' "$VP" | sha256sum | cut -c1-16)
echo "V3 version=$VV statut=$VS empreinte=$EMP"
[ "$VV" = 3 ] && [ "$VS" = completed ] \
  && [ "$EMP" = "$EMP_V3" ] || ko "v3_change"
[ -z "$KO" ]
}
pret() {
  local i s a
  for i in $(seq 1 30); do
    a=$(app_ctr)
    s=$(docker exec "$a" node -e '
const k = process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const u = (process.env.SUPABASE_URL || "")
  .replace(/\/$/, "") + "/rest/v1/users?limit=0";
fetch(u, { headers: { apikey: k,
  Authorization: "Bearer " + k } })
  .then((r) => console.log(r.status))
  .catch(() => console.log(0));' 2>/dev/null)
    if [ "$s" = 200 ]; then
      echo "APP_PRETE_APRES=$((i*5))s"; return 0
    fi
    sleep 5
  done
  echo "APP_PRETE=non (dernier code $s)"; return 1
}
# ── Etat structurel : AVANT attendu = "f f 0 0 1 0 t 16 2"
etat_struct() {
  sqlw <<'SQL'
select
 (to_regclass('public.avatar_versions') is not null)::text
 || ' ' || (to_regclass('public.avatar_verrous_creation')
   is not null)::text
 || ' ' || (select count(*) from information_schema.columns
   where table_schema = 'public' and (
   (table_name = 'user_avatars' and column_name in
     ('active_version_id', 'is_default', 'updated_at'))
   or (table_name = 'avatar_generations' and column_name
     in ('avatar_version_id', 'engine'))
   or (table_name = 'autopilot_config'
     and column_name = 'avatar_id')))
 || ' ' || (select count(*) from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in
   ('activer_version_avatar', 'definir_avatar_par_defaut',
    'prendre_verrou_creation_avatar',
    'liberer_verrou_creation_avatar'))
 || ' ' || (select count(*) from pg_indexes
   where schemaname = 'public'
   and indexname = 'user_avatars_one_active_per_user_uidx')
 || ' ' || (select count(*) from pg_indexes
   where schemaname = 'public'
   and indexname = 'user_avatars_un_defaut_par_compte_uidx')
 || ' ' || (to_regclass('public.users') is not null
   and to_regclass('public.user_avatars') is not null
   and to_regclass('public.avatar_generations') is not null
   and to_regclass('public.autopilot_config') is not null
   )::text
 || ' ' || (select count(*) from information_schema.columns
   where table_schema = 'public'
   and table_name = 'user_avatars' and column_name in
   ('user_id', 'version', 'status', 'provider', 'avatar_type',
    'provider_avatar_id', 'provider_asset_id',
    'source_object_key', 'training_error', 'validated_at',
    'consent_text', 'consent_version', 'consent_at',
    'subject_type', 'created_at', 'deleted_at'))
 || ' ' || (select count(*) from information_schema.columns
   where table_schema = 'public'
   and table_name = 'avatar_generations'
   and column_name in ('user_avatar_id', 'avatar_version'));
SQL
}
ETAT_AVANT_ATTENDU="false false 0 0 1 0 true 16 2"
# ── Empreintes des DONNEES existantes (hors colonnes ajoutees)
snap() {
  sqlw <<'SQL'
select 'UA', count(*), md5(coalesce(string_agg((to_jsonb(a)
  - 'active_version_id' - 'is_default' - 'updated_at')::text,
  '|' order by a.id), '')) from public.user_avatars a;
select 'GEN', count(*), md5(coalesce(string_agg((to_jsonb(g)
  - 'avatar_version_id' - 'engine')::text, '|'
  order by g.id), '')) from public.avatar_generations g;
select 'AP', count(*), md5(coalesce(string_agg((to_jsonb(c)
  - 'avatar_id')::text, '|' order by c.user_id), ''))
  from public.autopilot_config c;
SQL
}
# ── v3 : "id version statut valide empreinte vivants"
lire_v3() {
  sqlw -v m="$MAIL_V3" <<'SQL' | while read -r i v s ok p n; do
select a.id, a.version, a.status,
  (a.validated_at is not null)::text,
  coalesce(a.provider_avatar_id, '-'),
  (select count(*) from public.user_avatars b
   where b.user_id = a.user_id and b.deleted_at is null)
from public.user_avatars a
join public.users u on u.id = a.user_id
where u.email = :'m' and a.deleted_at is null
order by a.created_at;
SQL
    printf '%s %s %s %s %s %s\n' "$i" "$v" "$s" "$ok" \
      "$(printf '%s' "$p" | sha256sum | cut -c1-16)" "$n"
  done
}
api() { # $1=methode $2=chemin $3=corps $4=avec_cle(1/0)
  docker exec -e M="$1" -e C="$2" -e B="${3:-}" \
    -e K="${4:-1}" "$(app_ctr)" node -e '
const k = process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const u = (process.env.SUPABASE_URL || "")
  .replace(/\/$/, "") + "/rest/v1" + process.env.C;
const h = { "Content-Type": "application/json" };
if (process.env.K === "1") {
  h.apikey = k; h.Authorization = "Bearer " + k; }
const o = { method: process.env.M, headers: h };
if (process.env.B) o.body = process.env.B;
fetch(u, o).then(async (r) => console.log(r.status + " "
  + (await r.text()).replace(/\s+/g, "").slice(0, 80)))
  .catch(() => console.log("0"));' 2>/dev/null
}
recharger_cache() {
  local i a b
  docker kill -s SIGUSR1 "$PG" >/dev/null \
    && echo "SIGUSR1_ENVOYE=oui"
  for i in $(seq 1 12); do
    a=$(api GET '/avatar_versions?select=id&limit=0')
    b=$(api GET \
      '/avatar_verrous_creation?select=user_id&limit=0')
    [ "${a%% *}" = 200 ] && [ "${b%% *}" = 200 ] \
      && { echo "CACHE_RECHARGE_APRES=$((i*5))s"; return 0; }
    [ "$i" = 6 ] && { sqlw -q -c "notify pgrst, 'reload schema'" \
      && echo "NOTIFY_PGRST_ENVOYE=oui"; }
    sleep 5
  done
  echo "CACHE_RECHARGE=non (${a%% *} ${b%% *})"; return 1
}
recharger_cache_rollback() {
  local i a
  docker kill -s SIGUSR1 "$PG" >/dev/null
  for i in $(seq 1 12); do
    a=$(api GET '/avatar_versions?select=id&limit=0')
    [ "${a%% *}" = 404 ] && { echo "CACHE_SANS_532=oui"
      return 0; }
    [ "$i" = 6 ] && sqlw -q -c "notify pgrst, 'reload schema'"
    sleep 5
  done
  echo "CACHE_SANS_532=non (${a%% *})"; return 1
}

echo "=== A. GARDES (lecture seule) ==="
EV=$(docker inspect "$PG" \
  --format '{{range .Config.Env}}{{println .}}{{end}}')
L=$(printf '%s\n' "$EV" \
  | sed -nE 's#^PGRST_DB_URI=[a-z]+://([^:@/]+).*#\1#p')
echo "CONTENEUR_POSTGREST=$PG LOGIN=$L"
[ "$L" = authenticator ] || stop "PostgREST login=$L"
controle authenticator > "$T/ctrl-avant.txt" || {
  grep -vE '^(Z |RPC |TABLE )' "$T/ctrl-avant.txt"
  stop "etat #533 non conforme"; }
grep -E '^(Z_EXECUTES|PGRST_|SERVICE_KEY|ANONYME|TABLES_200|V3 )' \
  "$T/ctrl-avant.txt"
EA=$(etat_struct) || stop "lecture structure"
echo "ETAT_STRUCTURE=$EA"
if [ "$EA" != "$ETAT_AVANT_ATTENDU" ]; then
  case "$EA" in
    "true true 6 4 0 1 "*) echo "MIGRATION_532_DEJA_APPLIQUEE=oui"
      stop "rien a faire" ;;
  esac
  stop "structure inattendue (partielle ou divergente)"
fi
V3A=$(lire_v3) || stop "lecture v3"
[ -n "$V3A" ] || stop "v3 introuvable"
set -- $V3A
V3_ID=$1
echo "V3 version=$2 statut=$3 validee=$4 empreinte=$5 vivants=$6"
[ "$(printf '%s\n' "$V3A" | grep -c .)" = 1 ] \
  || stop "le compte a plusieurs avatars vivants"
[ "$2 $3 $4 $5 $6" = "3 completed true $EMP_V3 1" ] \
  || stop "v3 inattendu"
# La migration ECRIT dans ces tables (is_default, versions) :
# un declencheur inconnu y modifierait des donnees existantes
# que le rollback ne saurait pas defaire. Present = STOP.
TG=$(sqlw <<'SQL'
select coalesce(string_agg(c.relname || '.' || t.tgname,
  ','), '-') from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal
and c.relname in ('user_avatars', 'avatar_generations',
  'autopilot_config');
SQL
) || stop "lecture des declencheurs"
echo "DECLENCHEURS_TABLES_AVATAR=$TG"
[ "$TG" = "-" ] || stop "declencheur(s) present(s) : a examiner"
SN0=$(snap) || stop "empreintes des donnees"
printf '%s\n' "$SN0" | awk '{print "DONNEES_"$1"="$2" lignes"}'
UA=$(sqlw -c "select count(*) from public.user_avatars")
echo "USER_AVATARS_LIGNES=$UA"
AV0=$(api GET '/avatar_versions?select=id&limit=0')
echo "API_AVATAR_VERSIONS_AVANT=${AV0%% *} (404 attendu)"
TB=$(sqlw -c "select pg_database_size('studiio')")
mkdir -p "$SAUV_RACINE" || stop "dossier de sauvegarde"
LIBRE=$(df -Pk "$SAUV_RACINE" | awk 'NR==2{print $4*1024}')
echo "BASE_MO=$((TB/1048576)) LIBRE_MO=$((LIBRE/1048576))"
[ "$LIBRE" -gt $((TB*3 + 524288000)) ] \
  || stop "espace disque insuffisant"
echo "GARDES=ok"

echo "=== B. SAUVEGARDE $SAUV ==="
[ -e "$SAUV" ] && stop "$SAUV existe deja"
mkdir -m 700 "$SAUV" || stop "creation $SAUV"
docker exec "$DB" pg_dump -U studiio -d studiio -Fc \
  > "$SAUV/base.dump" || stop "pg_dump"
docker exec "$DB" pg_dump -U studiio -d studiio \
  --schema-only > "$SAUV/schema.sql" || stop "schema"
for t in user_avatars avatar_generations autopilot_config; do
  sqlw -c "copy public.$t to stdout with csv header" \
    > "$SAUV/$t.csv" || stop "copie $t"
done
printf '%s\n' "$SN0" > "$SAUV/empreintes-donnees.txt"
printf '%s\n' "$EA" > "$SAUV/structure-avant.txt"
printf 'id=%s version=%s statut=%s empreinte=%s\n' \
  "$V3_ID" "$2" "$3" "$5" > "$SAUV/v3-avant.txt"
sqlw > "$SAUV/droits-avant.txt" <<'SQL'
select 'ROLE', rolname, rolcanlogin, rolsuper, rolinherit,
  rolbypassrls from pg_roles where rolname in
  ('studiio','authenticator','web_anon','service_role',
   'anon','authenticated') order by 2;
select 'TABLE', c.relname, coalesce(c.relacl::text, '-')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','p')
order by 2;
select 'FONCTION', p.oid::regprocedure,
  coalesce(p.proacl::text, '-'), p.prosecdef,
  coalesce(array_to_string(p.proconfig, ','), '-')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' order by 2;
select 'INDEX', indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename in
  ('user_avatars','avatar_generations','autopilot_config')
order by 2;
SQL
[ -s "$SAUV/droits-avant.txt" ] || stop "droits-avant vide"
cp "$T/migration.sql" "$SAUV/migration-532.sql"
cp "$T/rollback.sql" "$SAUV/rollback-532.sql"
grep -E '^(Z |PGRST_|TABLES_200|V3 )' "$T/ctrl-avant.txt" \
  > "$SAUV/controle-avant.txt"
NL=$(docker exec -i "$DB" pg_restore -l \
  < "$SAUV/base.dump" 2>/dev/null \
  | grep -c ' TABLE DATA public ')
echo "DUMP_TABLES_AVEC_DONNEES=$NL"
[ "${NL:-0}" -ge 19 ] || stop "dump illisible ou incomplet"
for t in user_avatars avatar_generations autopilot_config; do
  [ -s "$SAUV/$t.csv" ] || stop "$t.csv vide"
done
(cd "$SAUV" && sha256sum base.dump schema.sql *.csv *.txt \
  *.sql > empreintes.sha256 2>/dev/null \
  && sha256sum -c --quiet empreintes.sha256) \
  || stop "manifeste de sauvegarde"
du -sh "$SAUV" | awk '{print "SAUVEGARDE_TAILLE="$1}'
echo "SAUVEGARDE=ok $SAUV"

annuler() {
  echo "=== R. ROLLBACK ($1) ==="
  local ok=1 e s v
  docker exec -i "$DB" psql -U studiio -d studiio -q \
    -v ON_ERROR_STOP=1 < "$T/rollback.sql" >/dev/null \
    && echo "ROLLBACK_SQL=applique" \
    || { echo "ROLLBACK_SQL=ECHEC"; ok=0; }
  recharger_cache_rollback || ok=0
  e=$(etat_struct); echo "ETAT_STRUCTURE=$e"
  [ "$e" = "$ETAT_AVANT_ATTENDU" ] || ok=0
  s=$(snap); [ "$s" = "$SN0" ] && echo "DONNEES_INCHANGEES=oui" \
    || { echo "DONNEES_INCHANGEES=NON"; ok=0; }
  v=$(lire_v3); [ "$v" = "$V3A" ] && echo "V3_INTACT=oui" \
    || { echo "V3_INTACT=NON"; ok=0; }
  controle authenticator > "$T/ctrl-rb.txt" || ok=0
  grep -E '^(KO|Z_EXECUTES|TABLES_200|ANONYME|V3 )' \
    "$T/ctrl-rb.txt"
  echo "MIGRATION_532_APPLIQUEE=non"
  if [ "$ok" = 1 ]; then
    echo "VERDICT_FINAL=ROLLBACK (base revenue a l'etat d'avant)"
  else
    echo "VERDICT_FINAL=ROLLBACK_INCOMPLET : ne rien deployer ;"
    echo "  sauvegarde complete dans $SAUV (base.dump,"
    echo "  user_avatars.csv, avatar_generations.csv,"
    echo "  autopilot_config.csv). Ne rien relancer : STOP."
  fi
  exit 1
}

echo "=== C. MIGRATION #532 ==="
if docker exec -i \
  -e PGOPTIONS='-c lock_timeout=15s -c statement_timeout=300s' \
  "$DB" psql -U studiio -d studiio -q -v ON_ERROR_STOP=1 \
  < "$T/migration.sql" > "$T/mig.log" 2>&1; then
  echo "MIGRATION_SQL=appliquee (une transaction)"
else
  grep -E 'ERROR|ERREUR' "$T/mig.log" | head -3
  E2=$(etat_struct)
  if [ "$E2" = "$ETAT_AVANT_ATTENDU" ]; then
    echo "MIGRATION_SQL=refusee, transaction annulee"
    echo "BASE_INCHANGEE=oui"
    echo "VERDICT_FINAL=ECHEC_SANS_EFFET (reessayable)"
    exit 1
  fi
  annuler "migration en echec, etat $E2"
fi

echo "=== D. CACHE POSTGREST ==="
recharger_cache || annuler "PostgREST ne voit pas #532"

echo "=== E. CONTROLES APRES ==="
EP=$(etat_struct); echo "ETAT_STRUCTURE=$EP"
[ "$EP" = "true true 6 4 0 1 true 16 2" ] \
  || annuler "structure apres inattendue"
SN1=$(snap)
[ "$SN1" = "$SN0" ] && echo "DONNEES_EXISTANTES_INCHANGEES=oui" \
  || annuler "donnees existantes modifiees"
V3B=$(lire_v3)
[ "$V3B" = "$V3A" ] && echo "V3_LIGNE_INTACTE=oui" \
  || annuler "ligne v3 modifiee"
sqlw -v v="$V3_ID" > "$T/apres.txt" <<'SQL' \
  || annuler "lecture controles apres"
select 'C v3_version_active', exists (select 1
  from public.user_avatars a
  join public.avatar_versions v on v.id = a.active_version_id
  where a.id = :'v'::uuid and v.user_avatar_id = a.id
  and v.user_id = a.user_id and v.version = 3
  and a.version = 3 and v.status = 'completed'
  and v.provider_avatar_id = a.provider_avatar_id
  and v.validated_at is not null
  and v.activated_at is not null
  and v.abandoned_at is null);
select 'C v3_par_defaut', (select is_default
  from public.user_avatars where id = :'v'::uuid);
select 'C un_defaut_max_par_compte', coalesce((select max(n)
  from (select count(*) n from public.user_avatars
  where deleted_at is null and is_default
  group by user_id) x), 0) <= 1;
select 'C chaque_compte_a_un_defaut', not exists (
  select 1 from public.user_avatars a
  where a.deleted_at is null and not exists (
  select 1 from public.user_avatars b
  where b.user_id = a.user_id and b.deleted_at is null
  and b.is_default));
select 'C une_version_par_identite', (select count(*)
  from public.avatar_versions) = (select count(*)
  from public.user_avatars where deleted_at is null);
select 'C bail_vide', not exists (select 1
  from public.avatar_verrous_creation);
select 'C fonctions_droits', (select count(*)
  from pg_proc p join pg_namespace n
  on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in
  ('activer_version_avatar', 'definir_avatar_par_defaut',
   'prendre_verrou_creation_avatar',
   'liberer_verrou_creation_avatar')
  and not has_function_privilege('web_anon', p.oid,
    'EXECUTE')
  and has_function_privilege('service_role', p.oid,
    'EXECUTE')
  and not exists (select 1 from aclexplode(coalesce(
    p.proacl, acldefault('f', p.proowner))) x
    where x.grantee = 0)
  and array_to_string(p.proconfig, ',')
    = 'search_path=pg_catalog, public') = 4;
select 'C tables_droits', (select count(*)
  from unnest(array['public.avatar_versions',
  'public.avatar_verrous_creation']) t
  where not has_table_privilege('web_anon', t,
    'SELECT,INSERT,UPDATE,DELETE')
  and has_table_privilege('service_role', t,
    'SELECT,INSERT,UPDATE,DELETE')
  and not exists (select 1 from pg_class c,
    aclexplode(c.relacl) x where c.oid = t::regclass
    and x.grantee = 0)) = 2;
SQL
cat "$T/apres.txt"
NC=$(grep -c '^C .* t$' "$T/apres.txt")
echo "CONTROLES_SQL_OK=$NC/8"
[ "$NC" = 8 ] || annuler "controles SQL $NC/8"
Z1=00000000-0000-4000-8000-000000000532
B1="{\"p_user_id\":\"$Z1\",\"p_jeton\":\"$Z1\"}"
R1=$(api POST /rpc/liberer_verrou_creation_avatar "$B1")
B2="{\"p_user_id\":\"$Z1\",\"p_avatar_id\":\"$Z1\","
B2="$B2\"p_version_id\":\"$Z1\",\"p_active_attendue\":null}"
R2=$(api POST /rpc/activer_version_avatar "$B2")
R3=$(api GET '/avatar_versions?select=id&limit=0' '' 0)
R4=$(api POST /rpc/liberer_verrou_creation_avatar "$B1" 0)
echo "API_BAIL_SERVICE=${R1%% *} ${R1#* }"
echo "API_ACTIVER_SERVICE=${R2%% *} (sans effet : ids nuls)"
echo "API_ANONYME_VERSIONS=${R3%% *} API_ANONYME_RPC=${R4%% *}"
[ "$R1" = "200 false" ] || annuler "rpc bail via PostgREST"
case "$R2" in 200*introuvable*) ;;
  *) annuler "rpc activer via PostgREST" ;; esac
[ "${R3%% *}" = 401 ] && [ "${R4%% *}" = 401 ] \
  || annuler "acces anonyme ouvert"
controle authenticator > "$T/ctrl-apres.txt"
CR=$?
grep -vE '^(Z |RPC |TABLE )' "$T/ctrl-apres.txt"
[ "$CR" = 0 ] || annuler "controle #533 apres"
cp "$T/ctrl-apres.txt" "$SAUV/controle-apres.txt"
echo "AUCUN_APPEL_FOURNISSEUR=oui (seuls PostgreSQL/PostgREST)"
echo "MIGRATION_532_APPLIQUEE=oui"
echo "SAUVEGARDE=$SAUV"
echo "VERDICT_FINAL=VALIDE"
SCRIPT
