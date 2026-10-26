-- ROLLBACK de 2026-10-27-cinema-ia.sql
--
-- Detruit les films et travaux Cinema IA STOCKES EN BASE. Les objets MinIO
-- (`<proprietaire>/cinema/…`) ne sont pas touches : a purger separement si
-- besoin. Sauvegarder avant : `pg_dump -t cinema_films -t cinema_travaux`.
--
-- Revenir en arriere SANS cette migration est possible : l'application retombe
-- sur le magasin local tant que `CINEMA_STOCKAGE` n'est pas `durable`.
begin;
drop function if exists public.cinema_travail_reclamer(uuid, integer);
drop function if exists public.cinema_travail_creer(text, uuid, text, jsonb, jsonb, integer);
drop table if exists public.cinema_travaux;
drop table if exists public.cinema_films;
commit;
