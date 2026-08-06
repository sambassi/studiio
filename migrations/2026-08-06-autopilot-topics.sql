-- Autopilote — les thèmes que l'utilisateur choisit de faire tourner.
--
-- ⚠️ VIDE = TOUS LES THÈMES. Le défaut `'{}'` conserve exactement le
-- comportement actuel : la rotation parcourt les douze thèmes du Mode simple.
-- Aucune configuration existante ne change tant que son propriétaire n'a rien
-- choisi.
--
-- Le tableau accepte aussi des thèmes PERSONNALISÉS, écrits à la main : ils ne
-- figurent dans aucune liste, et c'est voulu.

alter table public.autopilot_config
  add column if not exists topics text[] not null default '{}';

-- Sans ces deux étapes, PostgREST répond « Could not find the table ... in the
-- schema cache » (cf. CLAUDE.md) : la colonne existe en base mais reste
-- invisible à l'application.
grant all on table public.autopilot_config to public;

-- Puis, sur le serveur :
--   docker kill -s SIGUSR1 studiio-postgrest
