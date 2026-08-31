-- ============================================================================
-- AUTOPILOTE M3-C — GENERATIONS DE CANDIDATS DE MONTAGE
--
-- ⚠️ NE PAS APPLIQUER EN PRODUCTION DANS CE LOT. Tant qu'elle n'est pas
--    appliquee, la table n'existe pas : la route M3-C repond « socle absent »
--    et TOUT le reste — M3-A, M3-B4, l'ecran d'analyse — continue a
--    l'identique.
--
-- A executer sur la base Postgres auto-hebergee (studiio-db).
--
-- UNE TABLE NOUVELLE, UN INDEX NOUVEAU SUR UNE TABLE EXISTANTE, AUCUNE
-- COLONNE MODIFIEE, AUCUNE DONNEE TOUCHEE.
--
-- ---------------------------------------------------------------------------
-- POURQUOI UNE TABLE DERIVEE, ET NON DES COLONNES SUR `rush_analyses`
-- ---------------------------------------------------------------------------
--
-- Dix lignes, comme demande :
--
--   1. Une analyse terminee est un FAIT HISTORIQUE. La version 7 a ete
--      produite un jour donne, par un modele donne. Lui ajouter des candidats
--      apres coup reecrirait un resultat deja constate.
--   2. Les candidats se REGENERENT sans que l'analyse change : autre modele,
--      autre invite, autre jour. Une colonne les ecraserait ; une table les
--      versionne.
--   3. Les deux etapes ont des fournisseurs, des couts et des echecs
--      DISTINCTS. `motif_echec` est deja pris par l'analyse : une generation
--      de candidats qui echoue n'a pas a faire echouer l'analyse qui a reussi.
--   4. L'idempotence a besoin d'un index unique partiel SUR L'OBJET
--      CONCERNE. Sur `rush_analyses`, il porte deja sur l'analyse active ;
--      il en faut un second, propre aux generations.
--   5. Une table derivee se supprime en cascade sans rien emporter d'autre.
--
-- ---------------------------------------------------------------------------
-- CE QUI N'EST PAS ICI
-- ---------------------------------------------------------------------------
--
-- Ni montage, ni rendu, ni musique, ni transition, ni sous-titre, ni
-- publication. M3-C v1 propose des PASSAGES ; il n'en coupe aucun.
--
-- Aucune URL, aucune cle de stockage : un candidat est un intervalle de
-- temps, il ne designe aucun objet.
--
-- Aucun debit. `usage` est une MESURE. Le debit viendra quand le cout reel
-- sera connu, et il passera par `debiter_credits_operation`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. LA GARANTIE QUI MANQUE SUR `rush_analyses`
-- ---------------------------------------------------------------------------
--
-- Meme geste, meme raison qu'en M3-B1 pour `rushes`. Les index existants de
-- `rush_analyses` sont la cle primaire, `rush_analyses_rush_version_unique`,
-- `rush_analyses_active_unique` et `rush_analyses_user_idx`. Aucun ne porte
-- les colonnes dont la cle etrangere composite a besoin, et PostgreSQL la
-- REFUSE sans index unique correspondant.
--
-- ⚠️ TROIS COLONNES, ET PAS DEUX. C'EST LE POINT.
--
-- Une premiere redaction posait `(id, user_id)`, puis DEUX cles etrangeres
-- separees depuis `rush_candidate_sets` :
--
--     (analysis_id, user_id) -> rush_analyses (id, user_id)
--     (rush_id,     user_id) -> rushes        (id, user_id)
--
-- Chacune etait vraie, et ensemble elles ne prouvaient PAS ce qu'on voulait.
-- Un utilisateur possedant deux rushes A et B pouvait ecrire une generation
-- qui designe l'analyse du rush A et annonce le rush B : la premiere cle
-- verifiait que l'analyse est a lui, la seconde que le rush est a lui, et
-- AUCUNE que les deux parlent du meme rush. L'ecran aurait alors liste les
-- passages du rush A sous le rush B.
--
-- Une seule cle sur TROIS colonnes ferme le triangle : l'analyse, son rush et
-- leur proprietaire sont verifies ensemble, par le moteur, en une fois.
--
-- L'index ne peut pas echouer sur un doublon : `(id, rush_id, user_id)`
-- contient la cle primaire `id`, il est donc unique par construction.
create unique index if not exists rush_analyses_id_rush_user_key
  on public.rush_analyses (id, rush_id, user_id);

-- ---------------------------------------------------------------------------
-- 2. GENERATIONS DE CANDIDATS
-- ---------------------------------------------------------------------------
create table if not exists public.rush_candidate_sets (
  id          uuid primary key default gen_random_uuid(),

  analysis_id uuid not null,

  -- Denormalise depuis l'analyse, comme `rush_analyses.rush_id` l'est depuis
  -- le rush : l'ecran liste les passages d'un rush, pas d'une analyse.
  rush_id     uuid not null,

  -- Denormalise, et garanti par la FK composite plus bas.
  user_id     uuid not null references public.users(id) on delete cascade,

  -- Regenerer ne detruit pas : la generation precedente reste lisible, et
  -- deux generations du meme materiau se comparent.
  version     integer not null default 1 check (version >= 1),

  -- Le MEME vocabulaire que `rush_analyses.etat`, et pas un plus petit.
  -- Un vocabulaire reduit ici obligerait chaque lecteur d'ecran a savoir
  -- lequel des deux il regarde.
  etat        text not null default 'en_attente'
                check (etat in ('en_attente', 'en_cours', 'reussie', 'echouee', 'annulee')),

  -- Une seule etape dans ce lot, mais nommee : `moteur.ts` a montre qu'une
  -- etape implicite devient introuvable des qu'il y en a deux.
  etape       text check (etape is null or etape in ('candidats')),

  -- ── UN SEUL FOURNISSEUR, ET IL EST NOMME ───────────────────────────────
  -- Meme forme que `rush_analyses.fournisseurs`, pour que les deux se lisent
  -- de la meme facon :
  --   { "candidats": {"fournisseur": "anthropic", "modele": "..."} }
  fournisseurs jsonb not null default '{}'::jsonb
                 check (jsonb_typeof(fournisseurs) = 'object'),

  -- ── LES CANDIDATS ───────────────────────────────────────────────────────
  --
  -- Un tableau, jamais un objet : ils sont ORDONNES par rang, et un objet
  -- perdrait cet ordre au premier aller-retour JSON.
  --
  -- Le `not like '%://%'` reprend la garde de `rush_analyses.vignettes` :
  -- un candidat est un intervalle de temps et une phrase courte. Aucune URL
  -- n'a de raison d'y entrer, donc aucune ne peut y entrer.
  candidats   jsonb not null default '[]'::jsonb
                check (jsonb_typeof(candidats) = 'array'
                       and candidats::text not like '%://%'),

  -- Jetons consommes. RENSEIGNE, JAMAIS DEBITE dans ce lot.
  usage       jsonb not null default '{}'::jsonb
                check (jsonb_typeof(usage) = 'object'),

  -- Vocabulaire ferme cote application, comme `rush_analyses.motif_echec`.
  motif_echec text check (motif_echec is null or length(motif_echec) <= 200),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- ── LA GARANTIE QUI COMPTE — UNE SEULE CLE, TROIS COLONNES ─────────────
  --
  -- Elle etablit d'un seul coup les trois faits :
  --
  --   * l'analyse existe ;
  --   * elle porte bien SUR CE RUSH ;
  --   * et elle appartient bien A CET UTILISATEUR.
  --
  -- Deux cles separees — une vers l'analyse, une vers le rush — laissaient
  -- passer une generation qui designe l'analyse d'un rush et annonce l'autre,
  -- des lors que les deux rushes appartiennent a la meme personne. Ce n'est
  -- pas une convention applicative qu'un futur appelant pourrait oublier :
  -- c'est le moteur qui refuse, ou ne refuse pas.
  --
  -- `on delete cascade` : une generation de candidats est une donnee DERIVEE
  -- d'une donnee elle-meme derivee. Elle n'a aucune valeur propre une fois
  -- son analyse disparue, et la retenir ferait echouer la suppression d'un
  -- rush. La cascade de `rush_analyses` vers `rushes` la propage.
  constraint rush_candidate_sets_analyse_rush_proprietaire
    foreign key (analysis_id, rush_id, user_id)
    references public.rush_analyses (id, rush_id, user_id)
    on delete cascade
);

-- Une version donnee d'une analyse n'existe qu'une fois.
create unique index if not exists rush_candidate_sets_analyse_version_unique
  on public.rush_candidate_sets (analysis_id, version);

-- ⚠️ L'INDEX QUI PORTE L'IDEMPOTENCE.
--
-- Au plus UNE generation active par analyse. Double clic, deux onglets, rejeu
-- de requete : la base refuse la seconde, et l'appelant n'a aucune
-- verification a ne pas oublier. C'est la garantie EN BASE que le `if
-- (existing) return` ne donne pas — deux requetes concurrentes passent toutes
-- deux le `if` avant que l'une n'ait ecrit.
--
-- Partiel : les generations TERMINEES ne sont pas contraintes, donc une
-- analyse peut porter dix generations passees et en demarrer une onzieme.
create unique index if not exists rush_candidate_sets_active_unique
  on public.rush_candidate_sets (analysis_id)
  where etat in ('en_attente', 'en_cours');

-- La lecture de l'ecran : les generations d'un rush, les plus recentes
-- d'abord.
create index if not exists rush_candidate_sets_rush_idx
  on public.rush_candidate_sets (rush_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. AUCUN DROIT A `public` — MEME RAISON QU'EN M3-A ET M3-B1
--
-- Les migrations sont appliquees avec `psql -U studiio` : `studiio` POSSEDE
-- les objets qu'elles creent, et un proprietaire n'a besoin d'aucun `GRANT`.
--
-- Aucune RLS n'est posee ici : une politique mal reglee couperait
-- l'application sans prevenir, et la question du role anonyme de PostgREST
-- concerne TOUTES les tables du projet. Elle reste un lot separe.
--
-- CONTROLE APRES APPLICATION :
--   select has_table_privilege('public', 'public.rush_candidate_sets', 'SELECT');
--     -- attendu : false
--   select tableowner from pg_tables where tablename = 'rush_candidate_sets';
--     -- attendu : studiio
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 4. APRES APPLICATION — ETAPE OBLIGATOIRE
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- Sans elle, la table existe en base et reste invisible de l'API : PostgREST
-- ne relit son cache de schema qu'au demarrage, et repondrait
-- « Could not find the table ... in the schema cache ».
--
-- CONTROLES (lecture seule) :
--   select to_regclass('public.rush_candidate_sets');
--   select indexname from pg_indexes
--    where schemaname = 'public'
--      and tablename in ('rush_analyses', 'rush_candidate_sets');
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.rush_candidate_sets'::regclass;
-- ---------------------------------------------------------------------------
