-- ============================================================================
-- AUTOPILOTE — UN SEUL POST PAR CRENEAU (index unique partiel sur scheduled_posts)
-- ============================================================================
--
-- ETAT : PREPAREE, NON APPLIQUEE. Rien ne s'execute sans le feu vert de l'utilisateur.
--
-- ORDRE EN PRODUCTION
--   1. CONTROLE PREALABLE, lecture seule :
--        migrations/controles/2026-10-29-scheduled-posts-creneau-unique.controle.sql
--      Il doit renvoyer ZERO ligne. Sinon : les doublons existants se traitent A LA MAIN,
--      cette migration ne supprime ni ne modifie rien.
--   2. cette migration (elle REFUSE de s'appliquer, sans rien changer, si un doublon existe) ;
--   3. aucun rechargement PostgREST : ni table ni fonction nouvelle, seulement un index ;
--   4. puis le deploiement de l'application (qui traduit l'erreur 23505 en « deja produit »).
--
-- CE QUE L'INDEX REPRESENTE
--   Une publication planifiee de l'Autopilote = (compte, jeton de creneau). Le jeton
--   `metadata.slotKey` vaut `<compte>|<date>|<heure>` (cron) ou `manuel:<compte>|<date>|<heure>`
--   (production manuelle). PLUSIEURS RESEAUX = UNE SEULE ligne : `platforms` est un tableau
--   de la meme ligne, l'index ne les compte pas.
--
-- CE QU'IL N'EMPECHE PAS (volontairement)
--   - les posts crees a la main, dupliques ou reposts depuis le Calendrier : `agent_generated`
--     est pose cote serveur par l'Autopilote seulement, donc faux pour eux ;
--   - les posts sans jeton (anciens) et les posts d'une autre source que `autopilote` ;
--   - deux comptes sur le meme horaire : le compte fait partie de la cle.
--
-- COUT : un index sur une table de taille modeste ; la creation prend brievement un verrou
-- qui retarde les ecritures (pas les lectures). A lancer hors pic.
-- ============================================================================

begin;

do $$
declare v_n bigint;
begin
  select count(*) into v_n from (
    select user_id, metadata->>'slotKey'
      from public.scheduled_posts
     where agent_generated is true
       and metadata->>'source' = 'autopilote'
       and metadata->>'slotKey' is not null
     group by user_id, metadata->>'slotKey'
    having count(*) > 1
  ) d;
  if v_n > 0 then
    raise exception 'scheduled_posts : % creneau(x) Autopilote en double — traiter les doublons a la main (voir le controle prealable), index NON cree', v_n
      using errcode = '23505';
  end if;
end $$;

create unique index if not exists scheduled_posts_autopilote_creneau_uniq
  on public.scheduled_posts (user_id, (metadata->>'slotKey'))
  where agent_generated is true
    and metadata->>'source' = 'autopilote'
    and metadata->>'slotKey' is not null;

commit;
