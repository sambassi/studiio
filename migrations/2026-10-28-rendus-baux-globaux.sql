-- ============================================================================
-- RENDUS AUTOPILOTE — LIMITE GLOBALE DE RENDUS SIMULTANES (baux en base)
-- ============================================================================
--
-- ETAT : PREPAREE, NON APPLIQUEE. Rien ne s'execute tant que l'utilisateur
-- n'a pas donne son feu vert. Ordre en production (regle durable du projet) :
--
--   1. cette migration, puis le controle en lecture seule en bas de fichier ;
--   2. rechargement du schema PostgREST (les droits sont deja inclus ci-dessous) :
--        docker kill -s SIGUSR1 studiio-postgrest
--   3. SEULEMENT ENSUITE le deploiement de l'application.
--
-- Tant qu'elle n'est pas appliquee, l'application retombe sur une limite EN
-- MEMOIRE par instance (journalisee) : jamais pire qu'aujourd'hui. Aucune donnee
-- existante n'est lue ni modifiee ; rien n'est supprime en dehors de cette table.
--
-- ---------------------------------------------------------------------------
-- CE QUE LA BASE GARANTIT ELLE-MEME
-- ---------------------------------------------------------------------------
--
--   - AU PLUS `p_max` RENDUS ACTIFS, TOUTES INSTANCES ET TOUS COMPTES CONFONDUS.
--     Le comptage et l'insertion se font sous UN verrou consultatif global :
--     deux conteneurs qui demandent en meme temps ne peuvent pas passer tous les
--     deux quand il ne reste qu'une place.
--   - UN TRAVAIL N'EST PAS EXECUTE DEUX FOIS : `job_id` est la cle primaire
--     (le `jobId` d'Autopilote est deterministe par creneau). Un second
--     lancement du meme travail pendant que le premier vit recoit `doublon`.
--   - UN BAIL EXPIRE TOUT SEUL : un conteneur mort ne bloque pas la file pour
--     toujours. Un rendu vivant renouvelle son bail (`rendu_bail_battre`).
--   - UN BAIL APPARTIENT A SON COMPTE : renouveler ou liberer exige le bon
--     `user_id`. Aucun compte ne libere ni ne prolonge le bail d'un autre.
--
-- Aucune ligne ne porte de media, d'URL ni de contenu : seulement qui, quel
-- travail, quelle instance, jusqu'a quand.
-- ============================================================================

begin;

create table if not exists public.rendu_baux (
  job_id     text primary key,
  user_id    uuid not null references public.users(id) on delete cascade,
  instance   text not null,
  acquis_le  timestamptz not null default now(),
  expire_le  timestamptz not null
);
create index if not exists rendu_baux_expire_idx on public.rendu_baux (expire_le);
create index if not exists rendu_baux_user_idx on public.rendu_baux (user_id);

-- PRENDRE un bail. Jamais d'exception pour un refus normal : UNE ligne.
--   (pris = true,  motif = null,     actifs = n)  place obtenue
--   (pris = false, motif = 'occupe', actifs = n)  toutes les places sont prises
--   (pris = false, motif = 'doublon', actifs = n) ce travail tient deja un bail vivant
create or replace function public.rendu_bail_prendre(
  p_user     uuid,
  p_job      text,
  p_instance text,
  p_max      integer,
  p_ttl_s    integer
) returns table (pris boolean, motif text, actifs integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_nb integer;
begin
  if p_user is null or p_job is null or length(p_job) = 0 or length(p_job) > 200 then
    raise exception 'bail invalide' using errcode = '22023';
  end if;
  if p_max is null or p_max < 1 or p_max > 16 then
    raise exception 'plafond de rendus invalide' using errcode = '22023';
  end if;
  if p_ttl_s is null or p_ttl_s < 30 or p_ttl_s > 3600 then
    raise exception 'duree de bail invalide' using errcode = '22023';
  end if;

  -- UN verrou pour toute la machine : comptage + insertion deviennent atomiques.
  perform pg_advisory_xact_lock(hashtextextended('rendu_baux', 0));

  delete from public.rendu_baux where expire_le < now();

  select count(*) into v_nb from public.rendu_baux;

  if exists (select 1 from public.rendu_baux b where b.job_id = p_job) then
    return query select false, 'doublon'::text, v_nb;
    return;
  end if;

  if v_nb >= p_max then
    return query select false, 'occupe'::text, v_nb;
    return;
  end if;

  insert into public.rendu_baux (job_id, user_id, instance, expire_le)
  values (p_job, p_user, coalesce(nullif(p_instance, ''), 'inconnue'), now() + make_interval(secs => p_ttl_s));

  return query select true, null::text, v_nb + 1;
end;
$$;

-- RENOUVELER : vrai seulement si le bail existe, est a CE compte et n'a pas expire.
-- Faux = bail perdu (le rendu continue mais n'est plus protege : l'appelant le journalise).
create or replace function public.rendu_bail_battre(
  p_user  uuid,
  p_job   text,
  p_ttl_s integer
) returns table (ok boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_n integer;
begin
  if p_ttl_s is null or p_ttl_s < 30 or p_ttl_s > 3600 then
    raise exception 'duree de bail invalide' using errcode = '22023';
  end if;
  update public.rendu_baux
     set expire_le = now() + make_interval(secs => p_ttl_s)
   where job_id = p_job and user_id = p_user and expire_le >= now();
  get diagnostics v_n = row_count;
  return query select v_n > 0;
end;
$$;

-- LIBERER : seulement le bail de CE compte. Idempotent.
create or replace function public.rendu_bail_liberer(
  p_user uuid,
  p_job  text
) returns table (ok boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_n integer;
begin
  delete from public.rendu_baux where job_id = p_job and user_id = p_user;
  get diagnostics v_n = row_count;
  return query select v_n > 0;
end;
$$;

-- Droits : moindre privilege (#533) — jamais `public`, `anon`, `web_anon`.
-- La table n'est lue ni ecrite directement par l'application : seulement les
-- trois fonctions (security definer, search_path fige).
revoke all on table public.rendu_baux from public;
revoke all on function public.rendu_bail_prendre(uuid, text, text, integer, integer) from public;
revoke all on function public.rendu_bail_battre(uuid, text, integer) from public;
revoke all on function public.rendu_bail_liberer(uuid, text) from public;
do $$
declare r text;
begin
  foreach r in array array['studiio', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant select, insert, update, delete on table public.rendu_baux to %I', r);
      execute format('grant execute on function public.rendu_bail_prendre(uuid, text, text, integer, integer) to %I', r);
      execute format('grant execute on function public.rendu_bail_battre(uuid, text, integer) to %I', r);
      execute format('grant execute on function public.rendu_bail_liberer(uuid, text) to %I', r);
    end if;
  end loop;
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- CONTROLE (lecture seule) — a lancer apres, puis recharger PostgREST :
--   select to_regclass('public.rendu_baux');
--   select proname, prosecdef, proconfig from pg_proc where proname like 'rendu_bail_%';
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'rendu_baux';                 -- jamais PUBLIC / web_anon
-- ═══════════════════════════════════════════════════════════════════════════
