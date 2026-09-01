-- ============================================================================
-- AUTOPILOTE M3-F — JEUX DE CLIPS MATERIALISES
--
-- ⚠️ NE PAS APPLIQUER EN PRODUCTION DANS CE LOT. Tant qu'elle n'est pas
--    appliquee, la table n'existe pas : la route M3-F repond « socle absent »
--    et TOUT le reste — M3-A a M3-E, l'ecran d'analyse — continue a
--    l'identique.
--
-- A executer sur la base Postgres auto-hebergee.
--
-- UNE TABLE NOUVELLE, UN INDEX NOUVEAU SUR UNE TABLE EXISTANTE, AUCUNE
-- COLONNE MODIFIEE, AUCUNE DONNEE TOUCHEE.
--
-- ---------------------------------------------------------------------------
-- CE QUE M3-F MATERIALISE, ET POURQUOI IL LUI FAUT SA TABLE
-- ---------------------------------------------------------------------------
--
-- M3-E rend une DECISION : « ce passage commence a 34,320 et finit a 37,240 ».
-- Il ne produit aucun octet, ne persiste rien, et se recalcule pour rien.
--
-- M3-F produit des OCTETS. Un fichier existe, il occupe du disque, et il
-- faudra un jour dire de quelle decision il est sorti. C'est exactement la
-- difference que le cadrage de M3-E annoncait : « la decision se figera au
-- rendu, quand il y aura enfin quelque chose dont etre comptable ».
--
-- ---------------------------------------------------------------------------
-- POURQUOI PAS `render_jobs`
-- ---------------------------------------------------------------------------
--
-- `render_jobs` est la file de rendu REMOTION : `video_id`, `composition_id`,
-- `input_props`, `output_url`. Elle est attachee a une VIDEO. Un jeu de clips
-- n'a pas de video, pas de composition, pas de props — il a un rush, un jeu
-- de candidats et une liste de fichiers. La reutiliser demanderait de laisser
-- `video_id` faux et `composition_id` vide, et rendrait les deux domaines
-- illisibles.
--
-- `rendus` n'est pas davantage le bon endroit : c'est la table de PREUVE ET
-- DE FACTURATION, avec son `operation` borne a cinq valeurs et son
-- `transaction_id`. M3-F v1 ne facture rien — il n'y ecrit donc pas.
--
-- ---------------------------------------------------------------------------
-- CE QUI N'EST PAS ICI
-- ---------------------------------------------------------------------------
--
-- Ni montage, ni transition, ni sous-titre, ni musique, ni publication, ni
-- facturation, ni normalisation des sources exotiques, ni purge programmee.
-- M3-F v1 DECOUPE ; il n'assemble rien.
--
-- Aucune URL : la table garde un COMPARTIMENT et une CLE. Une URL signee
-- serait permanente en base alors qu'elle vit quelques minutes.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. LA GARANTIE QUI MANQUE SUR `rush_candidate_sets`
-- ---------------------------------------------------------------------------
--
-- Meme geste, meme raison qu'en M3-B1 pour `rushes` et qu'en M3-C pour les
-- analyses. Les index existants de `rush_candidate_sets` sont la cle
-- primaire, `rush_candidate_sets_analyse_version_unique`,
-- `rush_candidate_sets_active_unique` et `rush_candidate_sets_rush_idx`.
-- Aucun ne porte les colonnes dont la cle etrangere composite a besoin, et
-- PostgreSQL la REFUSE sans index unique correspondant.
--
-- ⚠️ TROIS COLONNES, ET C'EST LE MEME PIEGE QU'EN M3-C.
--
-- Deux cles separees — une vers le jeu de candidats, une vers le rush —
-- seraient chacune vraies sans prouver ensemble ce qu'on veut : un
-- utilisateur possedant deux rushes pourrait ecrire un jeu de clips qui
-- designe les candidats du rush A en annoncant le rush B. Les fichiers du
-- premier s'afficheraient alors sous le second.
--
-- L'index ne peut pas echouer sur un doublon : `(id, rush_id, user_id)`
-- contient la cle primaire `id`, il est donc unique par construction.
create unique index if not exists rush_candidate_sets_id_rush_user_key
  on public.rush_candidate_sets (id, rush_id, user_id);

-- ---------------------------------------------------------------------------
-- 2. LES JEUX DE CLIPS
-- ---------------------------------------------------------------------------
create table if not exists public.rush_clip_sets (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references public.users(id) on delete cascade,

  -- ── L'IDENTITE IMMUTABLE DE LA DECISION MATERIALISEE ──────────────────
  --
  -- Ces colonnes ne decrivent pas « ou l'on en est » : elles disent DE QUOI
  -- ces fichiers sont sortis. Un rendu futur doit pouvoir repondre « ce clip
  -- vient de CETTE decision », sans rien avoir a redemander et sans qu'aucun
  -- « dernier » implicite ne puisse changer la reponse.
  candidate_set_id uuid not null,
  candidate_set_version integer not null check (candidate_set_version >= 1),
  rush_id uuid not null,
  analysis_id uuid not null,

  -- `null` est LEGITIME : un rush sans transcription reussie se decoupe quand
  -- meme, sur la seule decision visuelle et audio. Ce que la colonne interdit,
  -- c'est de figer « la derniere » sans dire laquelle.
  transcription_id uuid,
  transcription_version integer check (transcription_version is null
                                       or transcription_version >= 1),

  -- La version des heuristiques de M3-E qui a produit les BORNES. Le jour ou
  -- elles changeront, un jeu deja produit dira sous quelle regle il l'a ete.
  algorithme text not null check (length(algorithme) between 1 and 40),

  -- ⚠️ COMMENT LES OCTETS ONT ETE PRODUITS — codec, prereglage, qualite.
  --
  -- `algorithme` repond « comment les bornes ont ete decidees », `methode`
  -- repond « comment le fichier a ete fabrique ». Deux questions distinctes,
  -- et la seconde manquait a la premiere redaction.
  --
  -- Sans elle, passer de `x264-crf23-v1` a `x264-crf22-v2` sans toucher a
  -- M3-E aurait laisse la reutilisation rendre les ANCIENS fichiers : on
  -- aurait cru avoir reencode, et l'on aurait servi l'encodage precedent,
  -- sans qu'aucune erreur n'apparaisse.
  methode text not null check (length(methode) between 1 and 40),

  -- Regenerer ne detruit pas. En v1 aucun chemin ne cree une version 2 — un
  -- jeu reussi a l'identite identique est REUTILISE — mais la colonne existe
  -- pour que le jour ou ce sera necessaire, ce ne soit pas une migration de
  -- plus sur des donnees vivantes.
  version integer not null default 1 check (version >= 1),

  -- Le MEME vocabulaire d'etats que partout ailleurs dans l'Autopilote.
  etat text not null default 'en_attente'
    check (etat in ('en_attente', 'en_cours', 'reussie', 'echouee', 'annulee')),

  -- Deux etapes nommees, parce qu'elles echouent differemment : decouper est
  -- local et gratuit, televerser est distant. Un `motif_echec` sans etape ne
  -- dirait pas laquelle des deux a lache.
  etape text check (etape is null or etape in ('extraction', 'televersement')),

  -- ── LES CLIPS ───────────────────────────────────────────────────────────
  --
  -- Un TABLEAU, jamais un objet : ils sont ordonnes par rang.
  --
  -- ⚠️ `jsonb` ET NON UNE TABLE ENFANT. Six clips au plus — la borne de M3-C
  -- —, jamais interroges separement, toujours lus avec leur parent. Une table
  -- enfant couterait une jointure sur chaque lecture d'ecran pour six objets
  -- connus d'avance. C'est le raisonnement que M3-B1 a deja tranche pour
  -- `fournisseurs`, et il vaut mot pour mot ici.
  --
  -- Le `not like '%://%'` reprend la garde de `rush_analyses.vignettes` : un
  -- clip designe un COMPARTIMENT et une CLE. Une URL stockee ici serait
  -- permanente alors que tout acces doit passer par une signature breve.
  clips jsonb not null default '[]'::jsonb
    check (jsonb_typeof(clips) = 'array' and clips::text not like '%://%'),

  -- Octets produits, durees, methode. RENSEIGNE, JAMAIS DEBITE : M3-F v1
  -- n'appelle aucun fournisseur et ne facture rien.
  usage jsonb not null default '{}'::jsonb
    check (jsonb_typeof(usage) = 'object'),

  motif_echec text check (motif_echec is null or length(motif_echec) <= 200),

  created_at timestamptz not null default now(),

  -- ⚠️ `created_at` DATE LA DEMANDE, et c'est lui — pas `updated_at` — que la
  -- peremption compare a son seuil. Un `updated_at` bouge a chaque etape :
  -- un travail mort qui aurait eu le temps de passer `en_cours` repousserait
  -- indefiniment sa propre peremption.
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),

  -- ── LA GARANTIE QUI COMPTE — UNE SEULE CLE, TROIS COLONNES ─────────────
  --
  -- Elle etablit d'un coup les trois faits : le jeu de candidats existe, il
  -- porte bien SUR CE RUSH, et il appartient bien A CET UTILISATEUR.
  --
  -- `on delete cascade` : un jeu de clips est une donnee DERIVEE d'une
  -- decision elle-meme derivee. Il n'a aucune valeur propre une fois ses
  -- candidats disparus. Les OBJETS du stockage, eux, ne partent pas avec la
  -- ligne — leur purge est une dette assumee de M3-G.
  constraint rush_clip_sets_candidats_rush_proprietaire
    foreign key (candidate_set_id, rush_id, user_id)
    references public.rush_candidate_sets (id, rush_id, user_id)
    on delete cascade
);

-- Une version donnee d'un jeu de candidats n'existe qu'une fois.
create unique index if not exists rush_clip_sets_candidats_version_unique
  on public.rush_clip_sets (candidate_set_id, version);

-- ⚠️ L'INDEX QUI PORTE L'IDEMPOTENCE.
--
-- Au plus UN jeu actif par jeu de candidats. Double clic, deux onglets, rejeu
-- de requete : la base refuse le second, et l'appelant n'a aucune
-- verification a ne pas oublier. C'est ce que le `if (existant) return` ne
-- donne pas — deux requetes concurrentes passent toutes deux le `if` avant
-- que l'une n'ait ecrit, et deux ffmpeg partiraient sur les memes octets.
--
-- Partiel : les jeux TERMINES ne sont pas contraints.
create unique index if not exists rush_clip_sets_active_unique
  on public.rush_clip_sets (candidate_set_id)
  where etat in ('en_attente', 'en_cours');

-- La lecture de l'ecran : les jeux d'un utilisateur, les plus recents d'abord.
create index if not exists rush_clip_sets_user_idx
  on public.rush_clip_sets (user_id, created_at desc);

-- La recherche de REUTILISATION : « existe-t-il deja un jeu reussi portant
-- exactement cette identite ? ». Sans index, chaque POST balaierait la table.
--
-- `methode` en fait partie : c'est ce qui empeche de rendre les fichiers d'un
-- encodage precedent apres un changement de codec ou de qualite.
create index if not exists rush_clip_sets_identite_idx
  on public.rush_clip_sets (candidate_set_id, candidate_set_version, analysis_id, algorithme, methode);

-- ---------------------------------------------------------------------------
-- 3. AUCUN DROIT A `public` — MEME RAISON QUE PARTOUT AILLEURS
--
-- Les migrations sont appliquees avec `psql -U studiio` : `studiio` POSSEDE
-- les objets qu'elles creent, et un proprietaire n'a besoin d'aucun `GRANT`.
-- Un `grant ... to public` ouvrirait la table au role anonyme de PostgREST.
--
-- CONTROLES APRES APPLICATION :
--   select has_table_privilege('public', 'public.rush_clip_sets', 'SELECT');
--     -- attendu : false
--   select tableowner from pg_tables where tablename = 'rush_clip_sets';
--     -- attendu : studiio
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 4. APRES APPLICATION — ETAPE OBLIGATOIRE
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- Sans elle, la table existe en base et reste invisible de l'API : PostgREST
-- ne relit son cache de schema qu'au demarrage.
-- ---------------------------------------------------------------------------
