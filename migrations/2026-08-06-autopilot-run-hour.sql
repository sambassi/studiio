-- Autopilote — l'heure de départ, choisie par chaque utilisateur.
--
-- ⚠️ LES DÉFAUTS REPRODUISENT LE COMPORTEMENT ACTUEL. 8 h, Europe/Paris :
-- c'est exactement ce que le cron quotidien fait aujourd'hui (06:00 UTC).
-- Aucune configuration existante ne change d'horaire tant que son
-- propriétaire n'y touche pas.
--
-- Le déclencheur passera à un passage HORAIRE ; c'est le moteur qui écarte
-- les comptes dont ce n'est pas l'heure. Un seul cron, un horaire par
-- utilisateur.

alter table public.autopilot_config
  add column if not exists run_hour smallint not null default 8,
  add column if not exists run_timezone text not null default 'Europe/Paris';

-- Sans ces deux étapes, PostgREST répond « Could not find the table ... in the
-- schema cache » (cf. CLAUDE.md) : les colonnes existent en base mais restent
-- invisibles à l'application.
grant all on table public.autopilot_config to public;

-- Puis, sur le serveur :
--   docker kill -s SIGUSR1 studiio-postgrest
