-- Retour arriere de 2026-10-29-scheduled-posts-creneau-unique.sql.
-- Supprime uniquement l'index : aucune ligne de scheduled_posts n'est lue ni modifiee.
-- L'application continue de fonctionner (la relecture des creneaux apres le bail reste en place).
begin;
drop index if exists public.scheduled_posts_autopilote_creneau_uniq;
commit;
