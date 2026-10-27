-- Retour arriere de 2026-10-31-cinema-plafond-compte.sql.
-- Supprime les deux fonctions et les trois tables qu'elles seules utilisent.
-- ⚠️ DESTRUCTEUR pour l'historique des depenses reelles Cinema IA (journal et
-- compteurs) : a n'executer que si cette fonctionnalite est abandonnee, pas
-- pour un simple retour en arriere de code. Aucune autre table de Studiio
-- n'est touchee.
begin;
drop function if exists public.confirmer_depense_cinema(uuid, text, text, numeric);
drop function if exists public.reserver_depense_cinema(uuid, numeric, text, text, numeric, numeric);
drop table if exists public.cinema_depenses_journal;
drop table if exists public.cinema_depenses_comptes;
drop table if exists public.cinema_depenses_globales;
commit;
