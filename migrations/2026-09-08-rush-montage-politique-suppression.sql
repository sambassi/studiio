-- ============================================================================
-- A_7M2 — POLITIQUE DE SUPPRESSION DES MONTAGES : ALIGNER MONO ET MULTI-RUSH
--
-- ⚠️ NE PAS APPLIQUER EN PRODUCTION DANS CE LOT.
--
-- AUCUNE TABLE CREEE, AUCUNE COLONNE AJOUTEE OU SUPPRIMEE, AUCUNE LIGNE
-- TOUCHEE. Deux clés étrangères existantes changent de REGLE DE SUPPRESSION,
-- et rien d'autre.
--
-- ---------------------------------------------------------------------------
-- CE QUE LA BASE FAIT AUJOURD'HUI, ET POURQUOI C'EST FAUX
-- ---------------------------------------------------------------------------
--
-- Mesuré sur une base locale portant les migrations M3-F à A_7M, avec un plan
-- mono-rush, un plan multi-rush (sources A/B/C) et deux rendus `reussie`
-- portant chacun une clé de fichier :
--
--   delete from rush_clip_sets where id = <A>;
--     → le plan mono-rush disparaît          (cascade)
--     → la source A du plan multi disparaît  (cascade, plan tronqué en silence)
--     → LE RENDU MP4 DU PLAN MONO DISPARAIT  (cascade transitive)
--
-- Une seule ligne de nettoyage sur un jeu de clips détruit donc un montage
-- déjà rendu. Le fichier reste sur MinIO, mais plus rien en base ne dit de
-- quoi il sort : la preuve de rendu est perdue alors que les octets, eux,
-- sont toujours facturés.
--
-- C'est vrai en mono-rush comme en multi-rush : les deux chemins portent la
-- même cascade, donc ce lot n'a pas à réconcilier deux sémantiques
-- divergentes — il a à corriger une sémantique unique et fausse.
--
-- ---------------------------------------------------------------------------
-- LA REGLE RETENUE
-- ---------------------------------------------------------------------------
--
-- Un jeu de clips REFERENCE ne se supprime pas. Ni par un plan mono-rush, ni
-- par une source de plan multi-rush. Qui veut nettoyer supprime d'abord le
-- plan, explicitement.
--
-- Une règle unique vaut mieux qu'une cascade invisible, y compris pour un
-- plan brouillon : « brouillon » est un état applicatif, la base n'a pas à
-- deviner qu'un plan est jetable.
--
-- ---------------------------------------------------------------------------
-- POURQUOI `NO ACTION DEFERRABLE`, ET NI `RESTRICT` NI `NO ACTION` SEC
-- ---------------------------------------------------------------------------
--
-- Les trois variantes refusent bien le `delete` direct d'un jeu de clips
-- référencé. Elles ne se valent pas pour autant : la suppression d'un COMPTE
-- les départage, et elle a été mesurée, pas supposée.
--
--   `delete from users where id = <U>`
--
-- déclenche deux cascades sœurs — `rush_clip_sets.user_id` et
-- `rush_montage_plans.user_id` — dont PostgreSQL n'ordonne pas l'exécution.
--
--   RESTRICT           → vérifié IMMEDIATEMENT, dans l'instruction cascadée
--                        qui vide `rush_clip_sets`. Les plans ne sont pas
--                        encore partis : ERREUR. La suppression de compte
--                        devient impossible.
--   NO ACTION sec      → vérifié en fin de CETTE instruction cascadée, donc
--                        au même moment, pour la même raison : ERREUR.
--   NO ACTION DEFERRED → vérifié au COMMIT, quand les deux cascades ont
--                        toutes deux fini. Le compte part entièrement.
--
-- Les deux premières feraient d'une garantie d'intégrité un blocage RGPD :
-- un utilisateur ayant un seul montage ne pourrait plus supprimer son compte.
-- Seule la troisième tient les deux exigences à la fois.
--
-- Le prix à payer est connu et assumé : l'erreur remonte au COMMIT et non à
-- l'instruction. PostgREST enveloppe chaque requête dans une transaction, le
-- refus revient donc bien à l'appelant. Et aucun code applicatif ne supprime
-- aujourd'hui ces tables — vérifié : `rush_clip_sets`, `rush_montage_plans`,
-- `rush_montage_plan_sources` et `rush_montage_renders` n'ont aucun appelant
-- de suppression dans `src/`. Ce lot pose une garantie de base, il ne change
-- le comportement d'aucun écran.
--
-- ---------------------------------------------------------------------------
-- CE QUI N'EST PAS TOUCHE, ET POURQUOI
-- ---------------------------------------------------------------------------
--
-- `rush_montage_plan_sources_plan_proprietaire` (source → plan) reste en
-- CASCADE : une ligne de source n'a aucune valeur propre hors de son plan,
-- elle EST la relation. Supprimer le plan doit emporter ses sources, et rien
-- d'autre — ni le jeu de clips, ni le rush, ni l'analyse.
--
-- `rush_montage_renders_plan_proprietaire` (rendu → plan) reste en CASCADE.
-- C'est un CHOIX DE NE PAS TRANCHER ICI. Supprimer un plan supprime
-- aujourd'hui son rendu réussi, ce qui est une seconde politique, distincte
-- de celle-ci : elle demande de séparer « plan technique » et « MP4 publié »,
-- et donc son propre audit. Ce lot se contente de faire en sorte qu'on ne
-- puisse plus l'atteindre PAR ACCIDENT depuis un jeu de clips.
--
-- Aucun job de purge n'est créé. Aucune ligne n'est supprimée.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. PLAN MONO-RUSH → JEU DE CLIPS
-- ---------------------------------------------------------------------------
-- Le `drop` porte sur une contrainte, pas sur une table ni une colonne : la
-- recréer sous un autre `on delete` est la seule façon d'en changer la règle,
-- PostgreSQL n'offrant pas d'`alter constraint ... on delete`.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'rush_montage_plans_jeu_proprietaire'
      and conrelid = 'public.rush_montage_plans'::regclass
      and confdeltype <> 'a'
  ) then
    alter table public.rush_montage_plans
      drop constraint rush_montage_plans_jeu_proprietaire;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'rush_montage_plans_jeu_proprietaire'
      and conrelid = 'public.rush_montage_plans'::regclass
  ) then
    alter table public.rush_montage_plans
      add constraint rush_montage_plans_jeu_proprietaire
      foreign key (clip_set_id, user_id)
      references public.rush_clip_sets (id, user_id)
      on delete no action
      deferrable initially deferred;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. SOURCE MULTI-RUSH → JEU DE CLIPS
-- ---------------------------------------------------------------------------
-- Même règle exactement. Le multi-rush n'a jamais eu de sémantique propre :
-- il héritait de la cascade du mono-rush, il hérite maintenant du refus.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'rush_montage_plan_sources_jeu_proprietaire'
      and conrelid = 'public.rush_montage_plan_sources'::regclass
      and confdeltype <> 'a'
  ) then
    alter table public.rush_montage_plan_sources
      drop constraint rush_montage_plan_sources_jeu_proprietaire;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'rush_montage_plan_sources_jeu_proprietaire'
      and conrelid = 'public.rush_montage_plan_sources'::regclass
  ) then
    alter table public.rush_montage_plan_sources
      add constraint rush_montage_plan_sources_jeu_proprietaire
      foreign key (clip_set_id, user_id)
      references public.rush_clip_sets (id, user_id)
      on delete no action
      deferrable initially deferred;
  end if;
end $$;

commit;

-- ============================================================================
-- APRES APPLICATION — rappel de la procedure PostgREST
--
-- Aucune table n'est créée par ce fichier, donc aucun `grant` n'est requis et
-- le cache de schéma n'a rien de nouveau à apprendre. Le rechargement reste
-- sans risque si l'on veut être sûr :
--
--   docker kill -s SIGUSR1 studiio-postgrest
-- ============================================================================
