-- ============================================================================
-- AUTOPILOTE M3-A — SESSION DE TOURNAGE ET RUSHES INDEXES
--
-- ⚠️ TANT QU'ELLE N'EST PAS APPLIQUEE, les deux tables n'existent pas :
--    les routes du tournage repondent 503 en nommant ce fichier, et RIEN
--    d'autre ne change. Aucun ecran existant ne se comporte differemment.
--
-- A executer sur la base Postgres auto-hebergee (studiio-db).
--
-- DEUX TABLES NOUVELLES, AUCUNE MODIFICATION DE TABLE EXISTANTE : cette
-- migration ne peut pas casser l'existant.
--
-- ---------------------------------------------------------------------------
-- POURQUOI DE NOUVELLES TABLES, ET NON `autopilot_config.rush_urls`
-- ---------------------------------------------------------------------------
--
-- L'Autopilote garde aujourd'hui ses rushes dans `autopilot_config.rush_urls`,
-- un `text[]`, et le dernier utilise dans `last_rush_url`. Ca suffit a piocher
-- une video au hasard. Ca ne suffit a rien d'autre :
--
--   * un tableau d'URL n'a pas d'identite — on ne peut ni referencer un rush,
--     ni lui attacher quoi que ce soit plus tard ;
--   * il n'a pas d'ordre stable — reordonner, c'est reecrire le tableau ;
--   * il ne dit ni la taille, ni le type, ni si le fichier est reellement
--     arrive ;
--   * il ne connait pas la notion de TOURNAGE : tous les rushes d'un compte
--     sont dans le meme sac, quel que soit l'evenement filme.
--
-- Une Session de tournage est precisement ce sac-la : un evenement, un sujet,
-- une journee — d'ou sortiront plusieurs contenus. Les lots suivants y
-- accrocheront l'analyse, la selection et le montage. Ce lot-ci ne fait que
-- poser le socle : rien d'analytique n'entre dans ces tables.
--
-- `autopilot_config.rush_urls` n'est PAS touche. Les deux coexistent, et la
-- migration de l'un vers l'autre est une decision de produit, pas un effet de
-- bord de ce lot.
--
-- ---------------------------------------------------------------------------
-- CE QUI N'EST PAS STOCKE ICI
-- ---------------------------------------------------------------------------
--
-- Aucun octet de video. Le fichier vit dans MinIO, comme tous les medias de
-- Studiio, et ces tables n'en gardent que la CLE — `bucket` + `cle_objet`,
-- exactement ce que `/api/upload/signed-url` attribue.
--
-- On garde la cle et non l'URL : une URL est une facon de lire un objet a un
-- instant donne, et elle change avec la configuration du stockage. La cle,
-- elle, est ce qui identifie l'objet. `verifier-objet.ts` interroge deja le
-- stockage sur `(bucket, cle)` : les deux colonnes ci-dessous sont ce qu'il
-- attend, sans traduction.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. SESSIONS DE TOURNAGE
-- ---------------------------------------------------------------------------
create table if not exists public.shoot_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,

  -- Le nom que l'utilisateur donne au tournage. Obligatoire : une session
  -- sans nom est indistinguable des autres dans une liste, et c'est une liste
  -- qu'on vient consulter des semaines apres le tournage.
  titre      text not null check (length(btrim(titre)) between 1 and 200),

  -- Trois etats, et pas un de plus. `ouverte` accepte des rushes, `fermee`
  -- n'en accepte plus, `archivee` sort des listes courantes. Les etats
  -- d'ANALYSE viendront avec l'analyse — les inventer ici figerait un
  -- vocabulaire avant d'avoir la fonctionnalite.
  statut     text not null default 'ouverte'
               check (statut in ('ouverte', 'fermee', 'archivee')),

  -- Contexte libre : « cours du samedi », « interview Marie ». Facultatif.
  contexte   text check (contexte is null or length(contexte) <= 2000),

  -- Extensible, et VIDE par defaut. Les lots suivants y poseront ce qui leur
  -- appartient plutot que d'ajouter une colonne a chaque idee.
  metadata   jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ⚠️ INDISPENSABLE, ET PAS SEULEMENT POUR LA PERFORMANCE.
--
-- Cet index unique sur `(id, user_id)` est ce qui permet a `rushes` de porter
-- une CLE ETRANGERE COMPOSITE vers la session. Sans lui, PostgreSQL refuse
-- cette FK — et sans cette FK, rien en base n'empecherait un rush d'annoncer
-- un proprietaire different de celui de sa session.
create unique index if not exists shoot_sessions_id_user_key
  on public.shoot_sessions (id, user_id);

-- Les sessions d'une personne, les plus recentes d'abord : c'est la seule
-- lecture que fait l'ecran.
create index if not exists shoot_sessions_user_idx
  on public.shoot_sessions (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. RUSHES
-- ---------------------------------------------------------------------------
create table if not exists public.rushes (
  id               uuid primary key default gen_random_uuid(),

  shoot_session_id uuid not null,

  -- Denormalise, et garanti par la FK composite plus bas : les lectures se
  -- font par utilisateur, et une jointure a chaque controle de propriete est
  -- une occasion de l'oublier.
  user_id          uuid not null references public.users(id) on delete cascade,

  -- La CLE de l'objet, pas son URL. Voir l'en-tete.
  bucket           text not null check (length(bucket) between 1 and 64),
  cle_objet        text not null check (length(cle_objet) between 1 and 1024),

  -- Ce que le navigateur a envoye : utile pour reafficher, jamais pour
  -- decider. Facultatifs, parce que l'ingestion peut ne pas les connaitre.
  nom_origine      text check (nom_origine is null or length(nom_origine) <= 512),
  content_type     text check (content_type is null or length(content_type) <= 128),
  taille_octets    bigint check (taille_octets is null or taille_octets >= 0),

  -- Nullable, DELIBEREMENT : la duree d'une video ne se connait pas au
  -- moment ou le fichier arrive. Y mettre 0 par defaut ferait passer
  -- « inconnue » pour « vide », et c'est le genre de zero qu'on finit par
  -- afficher.
  duree_secondes   numeric(10,3) check (duree_secondes is null or duree_secondes >= 0),

  -- Ordre dans la session, decide par le serveur. Unique par session : deux
  -- rushes au meme rang rendraient l'ordre dependant du hasard du tri.
  rang             integer not null check (rang >= 0),

  -- `verifie` = le serveur a REGARDE l'objet dans le stockage et l'y a
  -- trouve. `indexe` reste possible pour un chemin futur qui indexerait sans
  -- preuve — il n'en existe aucun aujourd'hui. `absent` consigne un objet
  -- introuvable plutot que de supprimer la ligne en silence.
  etat             text not null default 'indexe'
                     check (etat in ('indexe', 'verifie', 'absent')),

  metadata         jsonb not null default '{}'::jsonb,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- ── LA GARANTIE QUI COMPTE ──────────────────────────────────────────────
  -- Cle etrangere COMPOSITE : un rush ne peut pas designer une session dont
  -- le proprietaire differe du sien. Ce n'est pas une convention applicative
  -- qu'un futur appelant pourrait oublier, c'est le moteur qui refuse.
  --
  -- `on delete restrict` et non `cascade` : supprimer une session qui porte
  -- des rushes doit etre un geste explicite, pas un effet de bord. Rien dans
  -- Studiio ne definissait de politique de suppression pour ce concept ; on
  -- prend la plus conservatrice, et on la documente ici.
  constraint rushes_session_meme_proprietaire
    foreign key (shoot_session_id, user_id)
    references public.shoot_sessions (id, user_id)
    on delete restrict
);

-- Un objet de stockage ne peut etre indexe qu'une fois. Sans cet index, un
-- double clic sur « ajouter » creerait deux rushes pour un seul fichier.
create unique index if not exists rushes_objet_unique
  on public.rushes (bucket, cle_objet);

-- L'ordre, garanti par la base.
create unique index if not exists rushes_session_rang_unique
  on public.rushes (shoot_session_id, rang);

-- La lecture de l'ecran : les rushes d'une session, dans l'ordre.
create index if not exists rushes_session_idx
  on public.rushes (shoot_session_id, rang);

-- ---------------------------------------------------------------------------
-- 3. AUCUN DROIT A `public` — ET C'EST DELIBERE
--
-- Les autres migrations du projet finissent par `grant all on table ... to
-- public`, avec ce commentaire : « sans ce grant, PostgREST repond "not in
-- schema cache" ». On ne le reprend pas ici, parce que la preuve du
-- contraire est dans le depot.
--
-- La migration du 29 aout fait `revoke all on function ... from public`, et
-- ses RPC sont bien apparues dans le document OpenAPI apres le SIGUSR1. Le
-- controle du 30 aout l'a montre chiffre a l'appui : `execute_public = false`,
-- `execute_studiio = true`.
--
-- La raison est simple : les migrations sont appliquees avec `psql -U
-- studiio`. `studiio` POSSEDE donc les objets qu'elles creent, et un
-- proprietaire n'a besoin d'aucun `GRANT`. Le grant a `public` n'ajoutait
-- rien a ce dont l'application a besoin — il ouvrait seulement les tables a
-- tout autre role.
--
-- ⚠️ CE QUE CECI NE REGLE PAS. Si le role anonyme de PostgREST est
-- lui-meme `studiio`, une requete anonyme s'execute EN TANT QUE
-- proprietaire, et aucun jeu de privileges n'y change rien — seule RLS
-- aiderait. Cette question concerne TOUTES les tables du projet, pas ces
-- deux-ci, et elle demande de connaitre la configuration de PostgREST. Elle
-- n'est pas tranchee dans ce lot, et aucune RLS n'y est posee : une RLS mal
-- reglee couperait l'application sans prevenir.
--
-- CONTROLE APRES APPLICATION :
--   select has_table_privilege('public', 'public.shoot_sessions', 'SELECT');
--     -- attendu : false
--   select tableowner from pg_tables where tablename = 'shoot_sessions';
--     -- attendu : studiio
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 4. APRES APPLICATION — ETAPE OBLIGATOIRE
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- Sans elle, les tables existent en base et restent invisibles de l'API.
--
-- CONTROLES (lecture seule) :
--   select to_regclass('public.shoot_sessions'), to_regclass('public.rushes');
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.rushes'::regclass;
--   select indexname from pg_indexes
--    where schemaname='public' and tablename in ('shoot_sessions','rushes');
-- ---------------------------------------------------------------------------
