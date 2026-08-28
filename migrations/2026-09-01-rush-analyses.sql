-- ============================================================================
-- AUTOPILOTE M3-B1 — SOCLE DE DONNEES DES ANALYSES DE RUSH
--
-- ⚠️ TANT QU'ELLE N'EST PAS APPLIQUEE, la table n'existe pas : rien ne
--    change. Aucune route d'analyse n'existe encore, aucun ecran ne la lit,
--    et le socle M3-A continue de fonctionner a l'identique.
--
-- A executer sur la base Postgres auto-hebergee (studiio-db).
--
-- UNE TABLE NOUVELLE, UN INDEX NOUVEAU SUR UNE TABLE EXISTANTE, AUCUNE
-- COLONNE MODIFIEE, AUCUNE DONNEE TOUCHEE.
--
-- ---------------------------------------------------------------------------
-- POURQUOI UNE TABLE, ET NON `rushes.metadata`
-- ---------------------------------------------------------------------------
--
-- `rushes.metadata` est ECRIT PAR LE NAVIGATEUR : la route d'indexation le
-- prend du corps POST (`metadataValide`, puis `metadata: entree.metadata`).
-- Y ranger un resultat d'analyse melangerait des faits produits par le
-- serveur avec des donnees que le client controle, et rendrait impossible
-- de distinguer les deux plus tard.
--
-- Deux raisons de plus, moins decisives mais reelles :
--
--   * un `jsonb` ne sait pas repondre « quelles analyses sont en attente ? »
--     sans parcourir toute la table ;
--   * une analyse relancee ECRASERAIT la precedente, alors qu'on veut
--     pouvoir comparer deux lectures du meme rush.
--
-- ---------------------------------------------------------------------------
-- CE QUI N'EST PAS ICI
-- ---------------------------------------------------------------------------
--
-- Ni segments candidats, ni scores, ni montage, ni publication. Ces concepts
-- appartiennent aux lots suivants et n'ont pas de forme arretee : les
-- declarer maintenant figerait un vocabulaire avant d'avoir la
-- fonctionnalite qui le porte. C'est le meme choix, et pour la meme raison,
-- que celui ecrit en tete de la migration M3-A.
--
-- Aucun octet de media, aucune URL. Les vignettes que produiront les lots
-- suivants sont designees par leur CLE d'objet, comme les rushes le sont
-- deja — une URL est une facon de lire un objet a un instant donne, et elle
-- change avec la configuration du stockage.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. LA GARANTIE QUI MANQUAIT SUR `rushes`
-- ---------------------------------------------------------------------------
--
-- ⚠️ INDISPENSABLE, ET PAS POUR LA PERFORMANCE.
--
-- M3-A a pose `shoot_sessions_id_user_key` pour que `rushes` puisse porter
-- une cle etrangere COMPOSITE vers sa session. `rushes` n'a pas recu
-- l'equivalent : ses index sont la cle primaire, `rushes_objet_unique`,
-- `rushes_session_rang_unique` et `rushes_session_idx`. Aucun ne porte
-- `(id, user_id)`.
--
-- Sans cet index, PostgreSQL REFUSE la cle etrangere composite de
-- `rush_analyses` — et sans cette cle, rien en base n'empecherait une
-- analyse d'annoncer un proprietaire different de celui de son rush.
--
-- L'index est cree sur une table qui contient deja des lignes en production.
-- Il ne peut pas echouer sur un doublon : `(id, user_id)` contient la cle
-- primaire `id`, donc il est unique par construction.
create unique index if not exists rushes_id_user_key
  on public.rushes (id, user_id);

-- ---------------------------------------------------------------------------
-- 2. ANALYSES DE RUSH
-- ---------------------------------------------------------------------------
create table if not exists public.rush_analyses (
  id         uuid primary key default gen_random_uuid(),

  rush_id    uuid not null,

  -- Denormalise, et garanti par la FK composite plus bas : les lectures se
  -- font par utilisateur, et une jointure a chaque controle de propriete est
  -- une occasion de l'oublier. Meme raisonnement que `rushes.user_id`.
  user_id    uuid not null references public.users(id) on delete cascade,

  -- Relancer une analyse ne detruit pas la precedente : elle en cree une
  -- nouvelle version. Comparer deux lectures du meme rush est le seul moyen
  -- de constater qu'un changement de modele ameliore ou degrade le resultat.
  version    integer not null default 1 check (version >= 1),

  -- Cinq etats, et pas un de plus.
  --
  -- `en_attente` — la ligne existe, le travail n'a pas commence.
  -- `en_cours`   — un traitement l'a prise en charge.
  -- `reussie`    — terminee, resultat exploitable.
  -- `echouee`    — terminee, `motif_echec` dit pourquoi.
  -- `annulee`    — close sans resultat, a la demande ou par reprise.
  --
  -- La ligne est creee AVANT tout travail : elle existe donc meme si le
  -- processus meurt, et une reprise peut la retrouver `en_cours` plutot que
  -- d'avoir a deviner qu'un travail a eu lieu.
  etat       text not null default 'en_attente'
               check (etat in ('en_attente', 'en_cours', 'reussie', 'echouee', 'annulee')),

  -- Ou en est le traitement, ou bien ou il a casse. `null` tant que rien
  -- n'a commence : une etape par defaut ferait passer « pas demarre » pour
  -- « en extraction ».
  etape      text check (etape is null
               or etape in ('extraction', 'visuel', 'transcription')),

  -- ── UN FOURNISSEUR PAR ETAPE, ET NON UN POUR TOUTE L'ANALYSE ───────────
  --
  -- Une analyse fait travailler plusieurs moteurs : l'extraction est locale
  -- (ffmpeg), la lecture visuelle passe par un fournisseur, la transcription
  -- par un autre. Une paire `fournisseur`/`modele` unique laisserait croire
  -- qu'un seul moteur produit tout le resultat, et il n'y aurait aucun moyen
  -- de savoir lequel a produit `resume` et lequel a produit `parole`.
  --
  -- La forme attendue, verifiee par le contrat TypeScript :
  --   { "extraction":     {"fournisseur":"local",      "modele": null},
  --     "visuel":         {"fournisseur":"anthropic",  "modele": "..."},
  --     "transcription":  {"fournisseur":"replicate",  "modele": "..."} }
  --
  -- Vide par defaut : une analyse `en_attente` n'a fait travailler personne.
  --
  -- Une seconde table `rush_analysis_steps` donnerait la meme information au
  -- prix d'une jointure sur toutes les lectures d'ecran, pour trois cles
  -- connues d'avance et jamais interrogees separement. Elle n'est pas creee.
  fournisseurs jsonb not null default '{}'::jsonb
                 check (jsonb_typeof(fournisseurs) = 'object'),

  -- La duree MESUREE, par opposition a `rushes.duree_secondes` qui reste
  -- `null` tant que rien ne l'a mesuree. Nullable ici aussi, et jamais zero :
  -- un zero se lirait comme « video vide ».
  duree_secondes numeric(10,3)
                   check (duree_secondes is null or duree_secondes >= 0),

  -- Ce qui se MESURE : largeur, hauteur, images par seconde, debit, codec,
  -- presence d'une piste audio, rotation.
  technique  jsonb not null default '{}'::jsonb
               check (jsonb_typeof(technique) = 'object'),

  -- Ce qui s'INTERPRETE, tenu a l'ecart de ce qui se mesure.
  resume     text check (resume is null or length(resume) <= 4000),
  textes_visibles jsonb not null default '[]'::jsonb
                    check (jsonb_typeof(textes_visibles) = 'array'),
  parole     jsonb not null default '{}'::jsonb
               check (jsonb_typeof(parole) = 'object'),
  audio      jsonb not null default '{}'::jsonb
               check (jsonb_typeof(audio) = 'object'),
  qualite    jsonb not null default '{}'::jsonb
               check (jsonb_typeof(qualite) = 'object'),

  -- Les CLES des vignettes dans le stockage, jamais leurs URL.
  --
  -- Le `not like '%://%'` n'est pas une elegance : c'est la seule facon de
  -- rendre la regle infaisable a contourner par inadvertance. Une URL
  -- stockee ici serait permanente, alors que tout acces au media doit passer
  -- par une signature a duree courte.
  vignettes  jsonb not null default '[]'::jsonb
               check (jsonb_typeof(vignettes) = 'array'
                      and vignettes::text not like '%://%'),

  -- Jetons consommes, secondes facturables, cout estime. RENSEIGNE, JAMAIS
  -- DEBITE dans ce lot : le debit viendra quand il y aura quelque chose a
  -- facturer, et il utilisera `debiter_credits_operation`, dont
  -- l'idempotence par `reference_id` est deja ecrite.
  usage      jsonb not null default '{}'::jsonb
               check (jsonb_typeof(usage) = 'object'),

  -- Vocabulaire ferme cote application, comme `rendus.motif_echec`.
  motif_echec text check (motif_echec is null or length(motif_echec) <= 200),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- ── LA GARANTIE QUI COMPTE ──────────────────────────────────────────────
  -- Cle etrangere COMPOSITE : une analyse ne peut pas designer un rush dont
  -- le proprietaire differe du sien. Ce n'est pas une convention applicative
  -- qu'un futur appelant pourrait oublier, c'est le moteur qui refuse.
  --
  -- `on delete cascade`, et non `restrict` comme entre session et rushes :
  -- une analyse est une donnee DERIVEE, sans valeur propre une fois son rush
  -- disparu. La retenir ferait echouer la suppression d'un rush pour
  -- proteger un resultat que plus rien ne concerne. Le cas de M3-A etait
  -- l'inverse : un rush est un fichier televerse par une personne, et sa
  -- disparition doit etre un geste explicite.
  constraint rush_analyses_rush_meme_proprietaire
    foreign key (rush_id, user_id)
    references public.rushes (id, user_id)
    on delete cascade
);

-- Une version donnee d'un rush n'existe qu'une fois.
create unique index if not exists rush_analyses_rush_version_unique
  on public.rush_analyses (rush_id, version);

-- ⚠️ L'INDEX QUI PORTE L'IDEMPOTENCE.
--
-- Au plus UNE analyse active par rush. Un double clic sur « Analyser », deux
-- onglets ouverts, un rejeu de requete : la base refuse la seconde, et
-- l'appelant n'a aucune verification a ne pas oublier.
--
-- Partiel, et c'est tout l'interet : les analyses TERMINEES ne sont pas
-- contraintes, donc un rush peut porter dix analyses passees et en demarrer
-- une onzieme.
create unique index if not exists rush_analyses_active_unique
  on public.rush_analyses (rush_id)
  where etat in ('en_attente', 'en_cours');

-- La lecture de l'ecran : les analyses d'une personne, les plus recentes
-- d'abord.
create index if not exists rush_analyses_user_idx
  on public.rush_analyses (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. AUCUN DROIT A `public` — MEME RAISON QU'EN M3-A
--
-- Les migrations anterieures a aout finissent par `grant all on table ... to
-- public` en affirmant que PostgREST l'exige. La migration du 29 aout prouve
-- le contraire : elle revoque, et ses RPC apparaissent bien dans le document
-- OpenAPI apres le SIGUSR1.
--
-- Les migrations sont appliquees avec `psql -U studiio` : `studiio` POSSEDE
-- les objets qu'elles creent, et un proprietaire n'a besoin d'aucun `GRANT`.
--
-- ⚠️ CE QUE CECI NE REGLE PAS. Si le role anonyme de PostgREST est lui-meme
-- `studiio`, une requete anonyme s'execute EN TANT QUE proprietaire, et
-- aucun jeu de privileges n'y change rien. Cette question concerne TOUTES
-- les tables du projet et reste un lot de durcissement separe. Aucune RLS
-- n'est posee ici : une politique mal reglee couperait l'application sans
-- prevenir.
--
-- CONTROLE APRES APPLICATION :
--   select has_table_privilege('public', 'public.rush_analyses', 'SELECT');
--     -- attendu : false
--   select tableowner from pg_tables where tablename = 'rush_analyses';
--     -- attendu : studiio
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 4. APRES APPLICATION — ETAPE OBLIGATOIRE
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- Sans elle, la table existe en base et reste invisible de l'API.
--
-- CONTROLES (lecture seule) :
--   select to_regclass('public.rush_analyses');
--   select indexname from pg_indexes
--    where schemaname = 'public'
--      and tablename in ('rushes', 'rush_analyses');
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.rush_analyses'::regclass;
-- ---------------------------------------------------------------------------
