-- CONTROLE PREALABLE — LECTURE SEULE. Ne modifie ni ne supprime rien.
-- Doit renvoyer ZERO ligne avant d'appliquer 2026-10-29-scheduled-posts-creneau-unique.sql.
-- Chaque ligne = un creneau Autopilote present plusieurs fois pour un meme compte
-- (a examiner et traiter a la main : quel post garder ?).
select user_id,
       metadata->>'slotKey'          as creneau,
       count(*)                      as nb_posts,
       array_agg(id order by created_at) as ids,
       array_agg(status order by created_at) as statuts
  from public.scheduled_posts
 where agent_generated is true
   and metadata->>'source' = 'autopilote'
   and metadata->>'slotKey' is not null
 group by user_id, metadata->>'slotKey'
having count(*) > 1
 order by nb_posts desc, user_id;

-- Pour information : combien de posts l'index couvrira (lecture seule).
select count(*) as posts_couverts
  from public.scheduled_posts
 where agent_generated is true
   and metadata->>'source' = 'autopilote'
   and metadata->>'slotKey' is not null;
