-- Autopilote — les affiches de l'utilisateur, et le choix du mode.
--
-- Jusqu'ici l'Autopilote choisissait SEUL sa photo d'affiche, cherchée chez
-- Pexels à partir du thème. C'est un bon défaut, et ce n'en est qu'un : une
-- marque qui a ses propres visuels veut les siens, pas ceux d'une banque.
--
-- ⚠️ `'auto'` PAR DÉFAUT, BANQUE VIDE : le comportement actuel, à l'identique.
-- Aucune configuration existante ne change. `'custom'` avec une banque vide
-- retomberait sur Pexels plutôt que de produire un montage sans affiche — un
-- réglage à moitié posé ne doit pas dégrader le résultat.

alter table public.autopilot_config
  add column if not exists poster_urls text[] not null default '{}',
  add column if not exists poster_mode text   not null default 'auto';

-- Le mode est une énumération de deux valeurs : une troisième n'aurait aucune
-- branche dans le moteur, et retomberait silencieusement sur `auto`.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'autopilot_config_poster_mode_connu'
  ) then
    alter table public.autopilot_config
      add constraint autopilot_config_poster_mode_connu
      check (poster_mode in ('auto', 'custom'));
  end if;
end $$;

-- Sans ces deux étapes, PostgREST répond « Could not find the table ... in the
-- schema cache » (cf. CLAUDE.md) : les colonnes existent en base mais restent
-- invisibles à l'application.
grant all on table public.autopilot_config to public;

-- Puis, sur le serveur :
--   docker kill -s SIGUSR1 studiio-postgrest
