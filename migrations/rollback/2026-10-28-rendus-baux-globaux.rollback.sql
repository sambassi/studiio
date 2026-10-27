-- Retour arriere de 2026-10-28-rendus-baux-globaux.sql.
-- Ne touche que les objets crees par cette migration. Les baux sont ephemeres
-- (ils expirent seuls) : les perdre ne perd aucun rendu ni aucun credit.
-- L'application retombe alors sur sa limite en memoire par instance.
begin;
drop function if exists public.rendu_bail_liberer(uuid, text);
drop function if exists public.rendu_bail_battre(uuid, text, integer);
drop function if exists public.rendu_bail_prendre(uuid, text, text, integer, integer);
drop table if exists public.rendu_baux;
commit;
