-- ============================================================================
-- CINEMA IA — LE STOCKAGE DURABLE : `cinema_films` et `cinema_travaux`
-- ============================================================================
--
-- ETAT : PREPAREE, NON APPLIQUEE. Rien ne s'execute tant que l'utilisateur
-- n'a pas donne son feu vert. Ordre en production (regle durable du projet) :
--
--   1. cette migration, puis le controle en lecture seule en bas de fichier ;
--   2. `grant` deja inclus ci-dessous, PUIS rechargement du schema :
--        docker kill -s SIGUSR1 studiio-postgrest
--   3. SEULEMENT ENSUITE le deploiement de l'application avec
--      `CINEMA_STOCKAGE=durable`.
--
-- Sans l'etape 2, PostgREST repond « Could not find the table … in the schema
-- cache » : un bug qui ressemble a une erreur applicative et qui est purement
-- infrastructurel.
--
-- ---------------------------------------------------------------------------
-- CE QUE LA BASE GARANTIT ELLE-MEME
-- ---------------------------------------------------------------------------
--
--   - UN FILM A UN PROPRIETAIRE (`users.id`), et disparait avec lui
--     (`on delete cascade`). Les OBJETS MinIO, eux, ne disparaissent pas : la
--     purge du stockage est la dette deja identifiee (tasks/dette-rgpd-purge-
--     stockage.md) et ce module ne la resout pas.
--   - UN SEUL TRAVAIL ACTIF PAR FILM : index unique partiel. Deux clics, deux
--     onglets, deux conteneurs : un seul lance, les autres retrouvent le meme
--     travail. C'est la protection contre la double generation.
--   - UN PLAFOND DE TRAVAUX ACTIFS PAR COMPTE, pose dans la fonction de
--     creation sous un verrou consultatif par compte (un `count -> insert` en
--     deux requetes laisserait passer N+1 travaux simultanes).
--   - UN BAIL : un travail `en_cours` dont le bail est expire est REPRENABLE
--     (serveur redemarre, conteneur remplace). `tentatives` compte les prises ;
--     au dela de 5 le travail passe en `echec` plutot que de boucler.
--   - UN JETON DE PRISE : les ecritures d'un travail exigent `tentatives = n`.
--     Un executeur dont le bail a ete repris (donc n a change) ne peut plus
--     rien ecrire — il s'arrete au lieu d'ecraser l'executeur courant.
--   - UNE VERSION PAR FILM : l'ecriture exige la version lue (`version = v`).
--     Un PATCH de l'utilisateur et la fin d'un rendu ne s'ecrasent pas.
--
-- AUCUNE URL, AUCUN SECRET dans ces tables : les medias sont des CLES d'objets
-- sous `<proprietaire>/cinema/<film>/…`, lisibles par leur seul proprietaire
-- au travers du relais de stockage existant.

begin;

-- 1. Les films ────────────────────────────────────────────────────────────
create table if not exists public.cinema_films (
  id            text primary key
                  check (id ~ '^film-[a-z0-9][a-z0-9-]{0,62}$'),
  proprietaire  uuid not null references public.users(id) on delete cascade,
  titre         text not null default '' check (length(titre) <= 200),
  film          jsonb not null check (jsonb_typeof(film) = 'object'),
  version       integer not null default 1 check (version >= 1),
  cree_le       timestamptz not null default now(),
  maj_le        timestamptz not null default now(),
  -- Un film est une histoire, des scenes, des references : quelques dizaines
  -- de kilo-octets. 2 Mo est une borne de securite, pas un objectif.
  check (pg_column_size(film) <= 2097152)
);

create index if not exists cinema_films_proprietaire_idx
  on public.cinema_films (proprietaire, maj_le desc);

-- 2. Les travaux de production ────────────────────────────────────────────
create table if not exists public.cinema_travaux (
  id                   uuid primary key default gen_random_uuid(),
  film_id              text not null references public.cinema_films(id) on delete cascade,
  proprietaire         uuid not null references public.users(id) on delete cascade,
  statut               text not null default 'en_attente'
                         check (statut in ('en_attente', 'en_cours', 'termine', 'echec', 'annule')),
  -- Empreinte de ce qui est demande (scenes + empreintes). Diagnostic
  -- seulement : l'idempotence reelle est « un seul travail actif par film »,
  -- et le cache par empreinte de scene.
  cle                  text not null check (length(cle) between 1 and 128),
  scenes_demandees     jsonb not null default '[]'::jsonb
                         check (jsonb_typeof(scenes_demandees) = 'array'),
  progression          jsonb not null default '{}'::jsonb
                         check (jsonb_typeof(progression) = 'object'),
  resultat             jsonb check (resultat is null or jsonb_typeof(resultat) = 'object'),
  erreur               text check (erreur is null or length(erreur) <= 500),
  reference            text check (reference is null or length(reference) <= 32),
  tentatives           integer not null default 0 check (tentatives between 0 and 5),
  annulation_demandee  boolean not null default false,
  bail_jusqua          timestamptz,
  cree_le              timestamptz not null default now(),
  maj_le               timestamptz not null default now(),
  termine_le           timestamptz
);

-- UN SEUL TRAVAIL ACTIF PAR FILM.
create unique index if not exists cinema_travaux_un_actif_par_film
  on public.cinema_travaux (film_id)
  where statut in ('en_attente', 'en_cours');

create index if not exists cinema_travaux_proprietaire_idx
  on public.cinema_travaux (proprietaire, cree_le desc);

-- 3. Creer — ou retrouver — le travail actif d'un film ────────────────────
--
-- Rend un objet JSON :
--   { "cree": true|false, "motif": null|"film_absent"|"trop_de_travaux",
--     "travail": { …ligne… } | null }
--
-- `film_absent` couvre aussi « film d'un autre compte » : meme reponse, rien
-- ne confirme l'existence d'un film d'autrui.
create or replace function public.cinema_travail_creer(
  p_film_id    text,
  p_proprietaire uuid,
  p_cle        text,
  p_scenes     jsonb,
  p_progression jsonb,
  p_max_actifs integer
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actif public.cinema_travaux;
  v_nouveau public.cinema_travaux;
  v_nb integer;
begin
  if p_max_actifs is null or p_max_actifs < 1 or p_max_actifs > 20 then
    raise exception 'plafond de travaux invalide' using errcode = '22023';
  end if;

  -- Verrou par COMPTE : le comptage et l'insertion deviennent atomiques.
  perform pg_advisory_xact_lock(hashtextextended('cinema_travail:' || p_proprietaire::text, 0));

  if not exists (
    select 1 from public.cinema_films f
    where f.id = p_film_id and f.proprietaire = p_proprietaire
  ) then
    return jsonb_build_object('cree', false, 'motif', 'film_absent', 'travail', null);
  end if;

  select * into v_actif from public.cinema_travaux t
   where t.film_id = p_film_id and t.statut in ('en_attente', 'en_cours');
  if found then
    return jsonb_build_object('cree', false, 'motif', null, 'travail', to_jsonb(v_actif));
  end if;

  select count(*) into v_nb from public.cinema_travaux t
   where t.proprietaire = p_proprietaire and t.statut in ('en_attente', 'en_cours');
  if v_nb >= p_max_actifs then
    return jsonb_build_object('cree', false, 'motif', 'trop_de_travaux', 'travail', null);
  end if;

  insert into public.cinema_travaux (film_id, proprietaire, cle, scenes_demandees, progression)
  values (p_film_id, p_proprietaire, p_cle, coalesce(p_scenes, '[]'::jsonb), coalesce(p_progression, '{}'::jsonb))
  returning * into v_nouveau;

  return jsonb_build_object('cree', true, 'motif', null, 'travail', to_jsonb(v_nouveau));
end;
$$;

-- 4. Prendre un travail ───────────────────────────────────────────────────
--
-- `en_attente`, ou `en_cours` dont le bail est expire. Atomique : deux
-- executeurs qui appellent en meme temps, un seul recoit la ligne, l'autre
-- recoit NULL. Au-dela de 5 prises, le travail passe en `echec`.
create or replace function public.cinema_travail_reclamer(
  p_id     uuid,
  p_bail_s integer
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v public.cinema_travaux;
begin
  if p_bail_s is null or p_bail_s < 10 or p_bail_s > 3600 then
    raise exception 'bail invalide' using errcode = '22023';
  end if;

  update public.cinema_travaux
     set statut = 'echec', erreur = 'trop de tentatives sans aboutir',
         termine_le = now(), maj_le = now()
   where id = p_id and statut = 'en_cours' and bail_jusqua < now() and tentatives >= 5;

  update public.cinema_travaux
     set statut = 'en_cours',
         tentatives = tentatives + 1,
         bail_jusqua = now() + make_interval(secs => p_bail_s),
         maj_le = now()
   where id = p_id
     and tentatives < 5
     and (statut = 'en_attente' or (statut = 'en_cours' and bail_jusqua < now()))
  returning * into v;

  if not found then return null; end if;
  return to_jsonb(v);
end;
$$;

-- 5. Droits ───────────────────────────────────────────────────────────────
-- Modele de moindre privilege (#533) : jamais `public`, `anon`, `web_anon`.
-- `service_role` est le backend ; `studiio` le proprietaire (migrations).
revoke all on table public.cinema_films from public;
revoke all on table public.cinema_travaux from public;
revoke all on function public.cinema_travail_creer(text, uuid, text, jsonb, jsonb, integer) from public;
revoke all on function public.cinema_travail_reclamer(uuid, integer) from public;
do $$
declare r text;
begin
  foreach r in array array['studiio', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant select, insert, update, delete on table public.cinema_films to %I', r);
      execute format('grant select, insert, update, delete on table public.cinema_travaux to %I', r);
      execute format('grant execute on function public.cinema_travail_creer(text, uuid, text, jsonb, jsonb, integer) to %I', r);
      execute format('grant execute on function public.cinema_travail_reclamer(uuid, integer) to %I', r);
    end if;
  end loop;
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- CONTROLE (lecture seule) — a lancer apres, puis recharger PostgREST :
--   select to_regclass('public.cinema_films'), to_regclass('public.cinema_travaux');
--   select proname, prosecdef, proconfig from pg_proc
--    where proname like 'cinema_travail_%';          -- prosecdef = t, search_path fige
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name in ('cinema_films', 'cinema_travaux');   -- jamais PUBLIC / web_anon
-- ═══════════════════════════════════════════════════════════════════════════
