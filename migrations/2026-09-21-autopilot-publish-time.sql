-- Autopilote — l'heure de PUBLICATION des vidéos produites, minutes comprises.
--
-- ⚠️ DISTINCTE DE `run_hour`. `run_hour` (entier 0–23) dit à quelle heure le
-- moteur PRODUIT ; `publish_time` (« HH:MM ») dit à quelle heure les posts
-- produits sont PROGRAMMÉS — le lendemain de la production, dans le fuseau
-- `run_timezone`. Jusqu'ici le moteur écrivait 18:00 en dur.
--
-- ⚠️ LE DÉFAUT REPRODUIT LE COMPORTEMENT ACTUEL : 18:00. Aucune
-- configuration existante ne change de créneau tant que son propriétaire
-- n'y touche pas.
--
-- Texte et non `time` : PostgREST renvoie une colonne `time` en « HH:MM:SS »,
-- et l'écran comme le moteur relisent « HH:MM » strict (`sanitizePublishTime`).
-- La contrainte ci-dessous garantit la forme en base.

alter table public.autopilot_config
  add column if not exists publish_time text not null default '18:00';

alter table public.autopilot_config
  drop constraint if exists autopilot_config_publish_time_hhmm;
alter table public.autopilot_config
  add constraint autopilot_config_publish_time_hhmm
  check (publish_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- Sans ces deux étapes, PostgREST répond « Could not find the table ... in the
-- schema cache » (cf. CLAUDE.md) : la colonne existe en base mais reste
-- invisible à l'application — et la route l'omet alors de l'upsert, en le
-- disant à l'écran (`publishTimeReady: false`).
grant all on table public.autopilot_config to public;

-- Puis, sur le serveur :
--   docker kill -s SIGUSR1 studiio-postgrest
