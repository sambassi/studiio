-- Rollback de 2026-11-01-cinema-abonnements.sql.
-- Retire les fonctions et les tables. ⚠️ Efface les compteurs et le journal des
-- quotas Cinema : a n'utiliser qu'avant toute mise en service.
drop function if exists public.finaliser_production_cinema(uuid, text, integer);
drop function if exists public.reserver_production_cinema(uuid, timestamptz, text, text, integer, integer);
drop function if exists public.confirmer_quota_cinema(uuid, text, text);
drop function if exists public.reserver_quota_cinema(
  uuid, timestamptz, timestamptz, text, text, integer, numeric, integer, integer, numeric);
drop table if exists public.cinema_quota_journal;
drop table if exists public.cinema_quota_consommation;
drop table if exists public.cinema_formules;
