-- Autopilote — la DATE DE DÉBUT de la programmation.
--
-- ⚠️ TROIS RÉGLAGES, TROIS QUESTIONS. `run_hour` (entier) dit à quelle heure
-- le moteur PRODUIT ; `publish_time` (« HH:MM ») à quelle heure les posts
-- produits sont PROGRAMMÉS ; `start_date` (jour, dans `run_timezone`) dit à
-- partir de QUAND. Deux effets, et deux seulement :
--
--   1. le moteur refuse de produire AVANT ce jour (`decideRun` →
--      `avant-la-date-de-debut`, silencieux comme « pas encore ») ;
--   2. la première publication est programmée AU PLUS TÔT ce jour
--      (`slotDate` part de `start_date` quand elle est après « demain »).
--
-- ⚠️ LE DÉFAUT REPRODUIT LE COMPORTEMENT ACTUEL : `null` = dès le prochain
-- passage. Aucune configuration existante ne change de calendrier tant que
-- son propriétaire n'y touche pas. Une date déjà passée est sans effet.
--
-- Type `date` et non `text` : PostgREST rend une colonne `date` en
-- « YYYY-MM-DD », exactement la forme que `<input type="date">`, l'écran et le
-- moteur échangent (`sanitizeStartDate`). Une date invalide est refusée par
-- Postgres avant d'atteindre la règle.

alter table public.autopilot_config
  add column if not exists start_date date null;

-- Sans ces deux étapes, PostgREST répond « Could not find the table ... in the
-- schema cache » (cf. CLAUDE.md) : la colonne existe en base mais reste
-- invisible à l'application — et la route l'omet alors de l'upsert, en le
-- disant à l'écran (`startDateReady: false`).
grant all on table public.autopilot_config to public;

-- Puis, sur le serveur :
--   docker kill -s SIGUSR1 studiio-postgrest
