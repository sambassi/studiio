-- ============================================================================
-- AUTOPILOTE M3-D2 — TRANSCRIPTIONS DE RUSH
--
-- ⚠️ NE PAS APPLIQUER EN PRODUCTION DANS CE LOT. Tant qu'elle n'est pas
--    appliquee, la table n'existe pas : la route M3-D2 repond « socle absent »
--    et TOUT le reste — M3-A, M3-B4, M3-C, M3-D1, l'ecran d'analyse —
--    continue a l'identique.
--
-- A executer sur la base Postgres auto-hebergee (studiio-db).
--
-- UNE TABLE NOUVELLE, AUCUNE COLONNE MODIFIEE, AUCUNE DONNEE TOUCHEE, AUCUN
-- INDEX NOUVEAU SUR UNE TABLE EXISTANTE — `rushes (id, user_id)` porte deja
-- l'index unique dont la cle etrangere composite a besoin (M3-B1).
--
-- ---------------------------------------------------------------------------
-- POURQUOI LA TRANSCRIPTION PEND AU **RUSH**, ET NON A UNE ANALYSE
-- ---------------------------------------------------------------------------
--
-- C'est la difference avec M3-C, et elle est structurante.
--
-- Une generation de CANDIDATS depend de ce qu'un modele a VU : elle n'a de
-- sens qu'attachee a la version d'analyse qui lui a montre ces huit images.
-- Changez l'analyse, les candidats ne veulent plus rien dire.
--
-- Une TRANSCRIPTION ne depend de rien de tout cela. Elle depend du FICHIER,
-- et le fichier ne change pas : les memes octets rendent les memes mots aux
-- memes instants, que le rush ait ete analyse une fois ou dix. L'attacher a
-- une version d'analyse obligerait a la refaire — et a la repayer — a chaque
-- nouvelle analyse du meme rush, pour un resultat identique.
--
-- Attachee au rush, elle se transcrit UNE fois et sert TOUTES les analyses et
-- tous les candidats de ce rush. La jointure future est immediate :
--   candidat -> analyse -> rush_id -> transcription.
--
-- ---------------------------------------------------------------------------
-- POURQUOI PAS `rush_analyses.parole`
-- ---------------------------------------------------------------------------
--
--   1. Une analyse `reussie` est CLOSE : `majAnalyse` filtre sur
--      `etat in (en_attente, en_cours)`. Y ecrire obligerait a transcrire
--      PENDANT le pipeline, donc a relancer — et a repayer — l'analyse
--      visuelle entiere le jour ou le drapeau passe de OFF a ON.
--   2. `analysePublique` rend `parole` EN ENTIER, et l'ecran d'analyse sonde
--      toutes les quelques secondes. Un tableau de mots horodates repartirait
--      au navigateur a chaque tour.
--   3. Retranscrire — autre modele, autre langue — ne doit pas detruire la
--      transcription precedente. Une colonne ecrase ; une table versionne.
--
-- `rush_analyses.parole` reste donc VIDE et disponible. Ce lot n'y touche pas.
--
-- ---------------------------------------------------------------------------
-- CE QUI N'EST PAS ICI
-- ---------------------------------------------------------------------------
--
-- Ni moteur de coupe, ni sous-titre, ni montage, ni traduction, ni diarisation,
-- ni debit de credits. M3-D2 v1 rend du TEXTE HORODATE ; il ne coupe rien.
--
-- Aucune cle de stockage, aucun en-tete, aucun champ brut du fournisseur : la
-- table ne recoit que ce que le contrat RECONSTRUIT. Le TEXTE, lui, peut
-- contenir ce que les gens disent — une adresse de site comprise.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. LES TRANSCRIPTIONS
-- ---------------------------------------------------------------------------
create table if not exists public.rush_transcriptions (
  id          uuid primary key default gen_random_uuid(),

  rush_id     uuid not null,

  -- Denormalise, et garanti par la FK composite plus bas.
  user_id     uuid not null references public.users(id) on delete cascade,

  -- Retranscrire ne detruit pas : la version precedente reste lisible, et
  -- deux transcriptions du meme fichier se comparent.
  version     integer not null default 1 check (version >= 1),

  -- Le MEME vocabulaire d'etats que `rush_analyses` et `rush_candidate_sets`,
  -- et pas un plus petit : un vocabulaire reduit obligerait chaque lecteur
  -- d'ecran a savoir lequel des trois il regarde.
  etat        text not null default 'en_attente'
                check (etat in ('en_attente', 'en_cours', 'reussie', 'echouee', 'annulee')),

  -- Deux etapes NOMMEES, parce qu'elles echouent differemment : extraire la
  -- piste est local et gratuit, la transcrire est distant et facture. Un
  -- `motif_echec` sans etape ne dirait pas laquelle des deux a lache.
  etape       text check (etape is null or etape in ('extraction_audio', 'transcription')),

  -- ── UN SEUL FOURNISSEUR, ET IL EST NOMME ───────────────────────────────
  -- Meme forme que `rush_analyses.fournisseurs` et `rush_candidate_sets` :
  --   { "transcription": {"fournisseur": "groq", "modele": "..."} }
  fournisseurs jsonb not null default '{}'::jsonb
                 check (jsonb_typeof(fournisseurs) = 'object'),

  -- ── LE RESULTAT ─────────────────────────────────────────────────────────
  --
  -- `presente` a false N'EST PAS UN ECHEC : c'est le resultat « ce rush ne
  -- porte pas de parole ». La distinction avec une transcription qui a rate
  -- vit dans `etat`, jamais ici.
  presente    boolean not null default false,

  -- Ce que le fournisseur a DETECTE. Borne, et nullable : personne ne doit
  -- lire une langue par defaut comme une langue mesuree.
  langue      text check (langue is null or (length(langue) between 1 and 40)),

  texte       text not null default '' check (length(texte) <= 60000),

  -- Des TABLEAUX, jamais des objets : segments et mots sont ORDONNES, et un
  -- objet perdrait cet ordre au premier aller-retour JSON.
  --
  -- ─────────────────────────────────────────────────────────────────────
  -- ⚠️ PAS DE `not like '%://%'` ICI, CONTRAIREMENT A `vignettes` ET
  --    `candidats` — ET C'EST UNE DIFFERENCE DE NATURE, PAS UN OUBLI.
  -- ─────────────────────────────────────────────────────────────────────
  --
  -- Une vignette est une CLE que le serveur fabrique : une URL n'y a aucune
  -- raison d'entrer, donc la base peut l'interdire. Un candidat est un
  -- intervalle et une phrase que le serveur ecrit : meme chose.
  --
  -- Une transcription, elle, est la PAROLE DE L'UTILISATEUR. « Retrouvez-nous
  -- sur https://studiio.pro » est une phrase parfaitement ordinaire dans un
  -- rush promotionnel. Une contrainte lexicale la ferait echouer, et l'echec
  -- porterait sur ce que quelqu'un a DIT — c'est-a-dire sur rien de dangereux.
  --
  -- La securite est donc STRUCTURELLE, et elle vit dans
  -- `transcription-contrat.ts` : l'objet ecrit est RECONSTRUIT champ par
  -- champ — `presente`, `langue`, `texte`, `segments`, `mots`, et rien
  -- d'autre. Un champ annexe du fournisseur, une URL signee, un en-tete, un
  -- identifiant de requete n'ont aucun CHEMIN vers cette table : ils ne sont
  -- pas filtres, ils ne sont jamais copies. Un test le verifie en injectant
  -- exactement ces champs.
  --
  -- Interdire un motif de texte, c'est se proteger d'un contenu ; ne jamais
  -- recopier un champ inconnu, c'est se proteger d'une structure. Seule la
  -- seconde protection vaut ici.
  segments    jsonb not null default '[]'::jsonb
                check (jsonb_typeof(segments) = 'array'),

  mots        jsonb not null default '[]'::jsonb
                check (jsonb_typeof(mots) = 'array'),

  -- Secondes facturables, octets envoyes. RENSEIGNE, JAMAIS DEBITE dans ce
  -- lot : le debit viendra quand le cout reel sera connu, et il passera par
  -- `debiter_credits_operation`.
  usage       jsonb not null default '{}'::jsonb
                check (jsonb_typeof(usage) = 'object'),

  -- Vocabulaire ferme cote application, comme `rush_analyses.motif_echec`.
  motif_echec text check (motif_echec is null or length(motif_echec) <= 200),

  created_at  timestamptz not null default now(),

  -- ⚠️ TROIS INSTANTS, ET PAS UN SEUL `updated_at`.
  --
  -- `created_at` date la DEMANDE — c'est lui, et lui seul, que la peremption
  -- des generations abandonnees compare a son seuil : un `updated_at` bouge a
  -- chaque changement d'etape, donc une generation morte qui aurait eu le
  -- temps de passer `en_cours` repousserait indefiniment sa propre
  -- peremption.
  --
  -- `started_at` date le debut du travail, `completed_at` sa fin, quelle
  -- qu'elle soit. Leur difference est la seule mesure honnete de ce qu'une
  -- transcription coute en temps.
  started_at   timestamptz,
  completed_at timestamptz,

  updated_at  timestamptz not null default now(),

  -- ── LA GARANTIE QUI COMPTE ──────────────────────────────────────────────
  --
  -- Cle etrangere COMPOSITE : une transcription ne peut pas designer un rush
  -- dont le proprietaire differe du sien. Ce n'est pas une convention
  -- applicative qu'un futur appelant pourrait oublier, c'est le moteur qui
  -- refuse.
  --
  -- Deux colonnes suffisent ICI, la ou M3-C en exigeait trois : il n'y a
  -- qu'une seule entite designee. Le triangle « analyse / rush / proprietaire »
  -- que M3-C devait fermer n'existe pas quand on ne designe que le rush.
  --
  -- `on delete cascade` : une transcription est une donnee DERIVEE, sans
  -- valeur propre une fois son rush disparu. La retenir ferait echouer la
  -- suppression d'un rush pour proteger un resultat que plus rien ne concerne.
  constraint rush_transcriptions_rush_proprietaire
    foreign key (rush_id, user_id)
    references public.rushes (id, user_id)
    on delete cascade
);

-- Une version donnee d'un rush n'existe qu'une fois.
create unique index if not exists rush_transcriptions_rush_version_unique
  on public.rush_transcriptions (rush_id, version);

-- ⚠️ L'INDEX QUI PORTE L'IDEMPOTENCE.
--
-- Au plus UNE transcription active par rush. Double clic, deux onglets, rejeu
-- de requete : la base refuse la seconde, et l'appelant n'a aucune
-- verification a ne pas oublier. C'est la garantie EN BASE que le
-- `if (existing) return` ne donne pas — deux requetes concurrentes passent
-- toutes deux le `if` avant que l'une n'ait ecrit, et le fournisseur serait
-- paye deux fois.
--
-- Partiel : les transcriptions TERMINEES ne sont pas contraintes, donc un
-- rush peut porter dix transcriptions passees et en demarrer une onzieme.
create unique index if not exists rush_transcriptions_active_unique
  on public.rush_transcriptions (rush_id)
  where etat in ('en_attente', 'en_cours');

-- La lecture de l'ecran : les transcriptions d'un utilisateur, les plus
-- recentes d'abord.
create index if not exists rush_transcriptions_user_idx
  on public.rush_transcriptions (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. AUCUN DROIT A `public` — MEME RAISON QU'EN M3-A, M3-B1 ET M3-C
--
-- Les migrations sont appliquees avec `psql -U studiio` : `studiio` POSSEDE
-- les objets qu'elles creent, et un proprietaire n'a besoin d'aucun `GRANT`.
-- Un `grant all ... to public` ouvrirait la table au role anonyme de
-- PostgREST, c'est-a-dire a Internet.
--
-- Aucune RLS n'est posee ici : une politique mal reglee couperait
-- l'application sans prevenir, et la question du role anonyme de PostgREST
-- concerne TOUTES les tables du projet. Elle reste un lot separe.
--
-- CONTROLE APRES APPLICATION :
--   select has_table_privilege('public', 'public.rush_transcriptions', 'SELECT');
--     -- attendu : false
--   select tableowner from pg_tables where tablename = 'rush_transcriptions';
--     -- attendu : studiio
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 3. APRES APPLICATION — ETAPE OBLIGATOIRE
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- Sans elle, la table existe en base et reste invisible de l'API : PostgREST
-- ne relit son cache de schema qu'au demarrage, et repondrait
-- « Could not find the table ... in the schema cache ».
--
-- CONTROLES (lecture seule) :
--   select to_regclass('public.rush_transcriptions');
--   select indexname from pg_indexes
--    where schemaname = 'public' and tablename = 'rush_transcriptions';
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.rush_transcriptions'::regclass;
-- ---------------------------------------------------------------------------
