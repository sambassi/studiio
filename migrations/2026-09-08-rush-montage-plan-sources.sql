-- ---------------------------------------------------------------------------
-- A_7M — LES SOURCES ORDONNEES D'UN PLAN DE MONTAGE
-- ---------------------------------------------------------------------------
--
-- ⚠️ CE QUI BLOQUAIT, EXACTEMENT
--
-- `rush_montage_plans.clip_set_id` est un scalaire `not null`, tenu par la
-- cle etrangere composite `rush_montage_plans_jeu_proprietaire` vers
-- `rush_clip_sets (id, user_id)`. Et `rush_clip_sets.rush_id` est lui-meme un
-- scalaire `not null`.
--
--   un plan  ->  un jeu de clips  ->  un rush
--
-- La chaine est verrouillee PAR LA BASE, pas par le code : aucune ecriture
-- applicative ne peut faire porter a un plan des clips venus de deux rushes.
--
-- ---------------------------------------------------------------------------
-- ⚠️ CETTE MIGRATION EST ADDITIVE, ET ELLE NE DETRUIT RIEN
-- ---------------------------------------------------------------------------
--
-- Elle n'efface aucune colonne, ne supprime aucune cle etrangere, ne touche
-- aucun plan existant autrement que pour lui donner la ligne de source qu'il
-- avait deja implicitement. Un plan mono-rush ecrit hier continue d'etre lu,
-- contraint et rendu exactement comme avant.
--
-- Trois gestes, et rien de plus :
--
--   1. les quatre scalaires de source deviennent NULLABLES — un plan
--      multi-rush ne peut pas en designer un seul sans mentir ;
--   2. une table de sources ORDONNEES, avec la propriete garantie par la base
--      comme partout ailleurs ;
--   3. une empreinte de sources, et une seconde unicite qui s'appuie dessus.
--
-- ---------------------------------------------------------------------------
-- ⚠️ CE QU'ELLE NE FAIT PAS
-- ---------------------------------------------------------------------------
--
--   • elle ne touche pas a `CLIPS_MAX` : six clips par JEU reste juste, et
--     n'empeche rien — un montage multi-rush agrege plusieurs jeux ;
--   • elle ne modifie pas le `jsonb` `plans` : les segments ne portent pas
--     encore leur source, ce sera le lot applicatif ;
--   • elle ne calcule aucune empreinte : la colonne existe, le calcul viendra
--     du serveur.
--
-- ---------------------------------------------------------------------------
-- 1. LES SCALAIRES DE SOURCE DEVIENNENT NULLABLES
-- ---------------------------------------------------------------------------
--
-- ⚠️ NULL PLUTOT QU'UNE PREMIERE SOURCE QUI PARLERAIT POUR TOUTES.
--
-- La tentation est de laisser `clip_set_id` designer « la source principale ».
-- Ce serait une valeur fausse dans une colonne d'identite : le jour ou
-- quelqu'un s'y fierait pour retrouver la transcription d'un segment, il
-- lirait le mauvais rush, et rien ne le signalerait. Un plan multi-rush laisse
-- donc ces quatre colonnes VIDES, et dit ses sources dans la table dediee.
--
-- ⚠️ ET LA CLE ETRANGERE HISTORIQUE SURVIT.
--
-- `rush_montage_plans_jeu_proprietaire` porte sur `(clip_set_id, user_id)`.
-- En `match simple` — le defaut — une cle composite dont UNE colonne est nulle
-- n'est pas verifiee. Les plans mono-rush restent donc contraints exactement
-- comme avant, et les plans multi-rush passent a cote sans qu'on ait eu a
-- supprimer quoi que ce soit. C'est pourquoi cette migration ne fait aucun
-- `drop constraint`.
alter table public.rush_montage_plans
  alter column clip_set_id drop not null,
  alter column clip_set_version drop not null,
  alter column candidate_set_id drop not null,
  alter column analysis_id drop not null;

-- ⚠️ `algorithme` ET `methode_materialisation` RESTENT `not null`.
--
-- Ils disent comment les bornes ont ete decidees et comment les octets ont ete
-- produits. Ces deux reponses sont communes a toutes les sources d'un meme
-- montage — elles viennent des memes versions de M3-E et de M3-F. Les rendre
-- nullables aurait ouvert la porte a un plan qui ne saurait plus sous quelle
-- regle il a ete bati.

-- ---------------------------------------------------------------------------
-- 2. L'EMPREINTE DES SOURCES ORDONNEES
-- ---------------------------------------------------------------------------
--
-- ⚠️ ELLE REMPLACE `clip_set_id` DANS L'IDENTITE, ELLE NE S'Y AJOUTE PAS.
--
-- L'unicite historique demande « ce plan a-t-il deja ete calcule ? » et
-- repond par le jeu de clips. Pour un montage a plusieurs sources, la question
-- est la meme mais la reponse tient a la LISTE ORDONNEE des sources : A puis B
-- n'est pas le meme montage que B puis A, meme avec les memes clips.
--
-- ⚠️ ELLE EST AUSSI LE TEMOIN D'INTEGRITE.
--
-- Si un jeu de clips disparait, sa ligne de source part avec lui (cascade
-- ci-dessous) et le plan se retrouve avec une source de moins. Recalculer
-- l'empreinte depuis les lignes survivantes rend alors une valeur DIFFERENTE
-- de celle stockee : l'amputation se voit, sans avoir a tenir un compteur qui
-- pourrait deriver. C'est pour cette raison qu'aucune colonne `source_count`
-- n'est ajoutee.
--
-- `null` pour tous les plans mono-rush, historiques comme futurs. C'est ce qui
-- laisse les deux unicites cohabiter sans se marcher dessus.
alter table public.rush_montage_plans
  add column if not exists source_set_fingerprint text
    check (source_set_fingerprint is null
           or length(source_set_fingerprint) between 8 and 128);

comment on column public.rush_montage_plans.source_set_fingerprint is
  'A_7 — empreinte des sources ORDONNEES (ordinal, clip_set_id, clip_set_version). '
  'NULL pour un plan mono-rush, qui reste gouverne par rush_montage_plans_identite_unique.';

-- ---------------------------------------------------------------------------
-- 3. LA CLE QUI RENDRA LA PROPRIETE VERIFIABLE PAR LA BASE
-- ---------------------------------------------------------------------------
--
-- Meme raisonnement que `rush_clip_sets_id_user_key` : une cle etrangere
-- composite vers `(id, user_id)` etablit d'un coup que le plan existe ET qu'il
-- appartient bien a cet utilisateur. Deux cles separees seraient chacune
-- vraies sans prouver ensemble ce qu'on veut.
--
-- L'index ne peut pas echouer sur un doublon : `(id, user_id)` contient la
-- cle primaire `id`, il est donc unique par construction.
create unique index if not exists rush_montage_plans_id_user_key
  on public.rush_montage_plans (id, user_id);

-- ---------------------------------------------------------------------------
-- 4. LES SOURCES ORDONNEES
-- ---------------------------------------------------------------------------
create table if not exists public.rush_montage_plan_sources (
  plan_id uuid not null,

  -- Denormalise, et garanti par les deux cles etrangeres composites plus bas.
  -- Les lectures se font par utilisateur, et une jointure a chaque controle de
  -- propriete est une occasion de l'oublier.
  user_id uuid not null,

  -- ⚠️ LA PLACE DE LA SOURCE, PAS SON IMPORTANCE.
  --
  -- `ordinal` ordonne les SOURCES pour que l'empreinte soit calculable de
  -- facon deterministe. Il ne dit rien de l'ordre des SEGMENTS a l'ecran :
  -- un montage peut montrer A, puis B, puis A de nouveau, et cela se lit dans
  -- le `jsonb` du plan, pas ici.
  ordinal integer not null check (ordinal >= 0 and ordinal <= 63),

  clip_set_id uuid not null,
  clip_set_version integer not null check (clip_set_version >= 1),

  created_at timestamptz not null default now(),

  -- ⚠️ LA CLE PRIMAIRE PORTE L'ORDRE.
  --
  -- Deux sources ne peuvent pas occuper la meme place : la base refuse, et
  -- l'appelant n'a aucune verification a ne pas oublier.
  constraint rush_montage_plan_sources_pkey primary key (plan_id, ordinal),

  -- ⚠️ UNE SOURCE N'APPARAIT QU'UNE FOIS DANS UN PLAN.
  --
  -- Reutiliser plusieurs passages d'un meme rush est le cas NORMAL — et cela
  -- se fait par plusieurs SEGMENTS pointant la meme source, jamais par deux
  -- lignes de source identiques. Deux lignes rendraient l'empreinte
  -- dependante d'un doublon sans signification, et la meme video aurait deux
  -- identites selon la facon dont on l'a ecrite.
  constraint rush_montage_plan_sources_jeu_unique unique (plan_id, clip_set_id),

  -- Le plan existe, et il appartient bien a cet utilisateur.
  --
  -- `on delete cascade` : une source n'a aucune valeur propre sans son plan.
  constraint rush_montage_plan_sources_plan_proprietaire
    foreign key (plan_id, user_id)
    references public.rush_montage_plans (id, user_id)
    on delete cascade,

  -- ⚠️ LA PROPRIETE DU JEU DE CLIPS, GARANTIE PAR LA BASE ET NON PAR UN `if`.
  --
  -- Sans cette cle, un plan pourrait nommer le jeu de clips d'autrui en
  -- annoncant son propre proprietaire, et les fichiers d'un tiers seraient
  -- montes sous le compte du demandeur. C'est exactement ce que
  -- `rush_montage_plans_jeu_proprietaire` empeche pour le mono-rush.
  --
  -- `on delete cascade` : C'EST DEJA LA SEMANTIQUE EN PLACE. Supprimer un jeu
  -- de clips supprime aujourd'hui les plans qui en derivent ; la ligne de
  -- source disparait donc avec lui, et l'empreinte stockee cesse de
  -- correspondre aux sources survivantes — ce qui rend l'amputation visible
  -- au lieu de la laisser passer pour un plan plus court.
  constraint rush_montage_plan_sources_jeu_proprietaire
    foreign key (clip_set_id, user_id)
    references public.rush_clip_sets (id, user_id)
    on delete cascade
);

comment on table public.rush_montage_plan_sources is
  'A_7 — les jeux de clips ORDONNES dont un plan de montage tire ses segments. '
  'Une ligne par source ; l''ordre des segments vit dans rush_montage_plans.plans.';

-- Les sources d'un plan, dans l'ordre — la lecture nominale.
create index if not exists rush_montage_plan_sources_plan_idx
  on public.rush_montage_plan_sources (plan_id, ordinal);

-- « Quels plans utilisent ce jeu de clips ? » — la recence par source, dont
-- l'anti-repetition multi-rush aura besoin.
create index if not exists rush_montage_plan_sources_jeu_idx
  on public.rush_montage_plan_sources (clip_set_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. LA SECONDE UNICITE
-- ---------------------------------------------------------------------------
--
-- ⚠️ L'INDEX HISTORIQUE N'EST NI TOUCHE NI RENDU PARTIEL.
--
-- `rush_montage_plans_identite_unique` porte sur `clip_set_id`, qui vaut NULL
-- pour tout plan multi-rush. En PostgreSQL, deux NULL ne sont pas egaux dans
-- un index unique : les lignes multi-rush ne peuvent donc pas y entrer en
-- collision, et il continue de gouverner les plans mono-rush exactement comme
-- avant. Le transformer en index partiel aurait ete un changement sans effet.
--
-- ⚠️ ET CELUI-CI RECOPIE LES MEMES DIMENSIONS, sans en retirer aucune.
--
-- `source_set_fingerprint` remplace le couple `(clip_set_id, clip_set_version)`
-- — il l'englobe, puisqu'il se calcule dessus. Les cinq autres dimensions sont
-- reprises telles quelles : les omettre aurait rendu le premier plan calcule
-- valable pour toute demande ulterieure, ce que l'index historique s'emploie
-- precisement a empecher.
create unique index if not exists rush_montage_plans_identite_sources_unique
  on public.rush_montage_plans (source_set_fingerprint, algorithme,
                                methode_materialisation, algorithme_plan,
                                format, duree_cible_secondes)
  where source_set_fingerprint is not null;

-- ---------------------------------------------------------------------------
-- 6. LES PLANS HISTORIQUES RECOIVENT LA SOURCE QU'ILS AVAIENT DEJA
-- ---------------------------------------------------------------------------
--
-- ⚠️ AUCUNE IDENTITE NE CHANGE.
--
-- Ce backfill n'ecrit RIEN dans `rush_montage_plans` : ni le `jsonb` des
-- segments, ni `source_set_fingerprint`, ni les scalaires historiques. Il
-- ajoute seulement, pour chaque plan mono-rush, la ligne de source qu'il
-- portait deja implicitement dans sa colonne `clip_set_id`.
--
-- Consequence directe : l'empreinte reste NULL, l'unicite historique continue
-- de gouverner ces plans, et AUCUN rendu deja reussi ne devient introuvable.
--
-- ⚠️ REJOUABLE SANS DOMMAGE. `on conflict do nothing` : appliquer la migration
-- deux fois, ou l'appliquer apres qu'un plan ait deja recu sa source, ne
-- produit aucun doublon et aucune erreur.
insert into public.rush_montage_plan_sources
  (plan_id, user_id, ordinal, clip_set_id, clip_set_version, created_at)
select p.id, p.user_id, 0, p.clip_set_id, p.clip_set_version, p.created_at
  from public.rush_montage_plans p
 where p.clip_set_id is not null
   and p.clip_set_version is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 7. AUCUN DROIT OUVERT
-- ---------------------------------------------------------------------------
--
-- Pas de `grant`, comme pour `rush_montage_plans` et `rush_clip_sets`. Le role
-- qui execute cette migration possede les objets qu'elle cree, et un
-- proprietaire n'a besoin d'aucun `GRANT`. Un `grant ... to public` ouvrirait
-- la table au role anonyme de PostgREST.
--
-- ---------------------------------------------------------------------------
-- 8. APRES APPLICATION
-- ---------------------------------------------------------------------------
--
-- Recharger le cache de schema de PostgREST :
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- Sans elle, la table existe en base et reste invisible de l'API : PostgREST
-- ne relit son cache de schema qu'au demarrage.
