-- ============================================================================
-- M3-H — LES RENDUS DU PLAN DE MONTAGE
-- ============================================================================
--
-- M3-G a decide : quels clips, dans quel ordre, combien de temps chacun, avec
-- quel recadrage, vers quel format. M3-H EXECUTE cette decision et produit un
-- fichier. Cette table porte l'etat de cette execution.
--
-- POURQUOI PAS `render_jobs`
-- ---------------------------------------------------------------------------
--
-- ⚠️ PAS PARCE QU'ELLE SERAIT MORTE. Une premiere redaction la disait « vide
-- en production, un vestige de l'ere Remotion ». C'etait faux, et la revue
-- l'a repris : `render_jobs` est ECRITE par un chemin vivant —
-- `/api/render/route.ts` y insere, `render/worker.ts` la met a jour,
-- `/api/render/status` la lit — et si elle est vide, c'est que
-- `/api/cron/cleanup-db` en supprime les lignes de plus de SEPT JOURS.
--
-- Ce sont trois raisons de fond qui l'ecartent, pas son inactivite :
--
--   1. SA PURGE. Le cron efface toute ligne de plus de sept jours. Un rendu
--      M3-H doit survivre a une semaine : y ecrire ferait disparaitre le lien
--      vers un fichier qui, lui, resterait dans le stockage.
--   2. SON VOCABULAIRE D'ETAT. Son `check` vaut
--      `queued/rendering/completed/failed/cancelled` ; M3-H parle
--      `en_attente/en_cours/reussie/echouee/annulee`. Les faire cohabiter
--      demanderait un `alter` sur une table qu'un autre parcours utilise.
--   3. SON MODELE. `composition_id` et `input_props` sont faits pour Remotion
--      — ils portent un DEFAULT, donc rien n'oblige a les remplir, mais les
--      laisser vides revient a ranger un rendu ffmpeg dans une file Remotion.
--      `output_url text` persiste une URL, ce que la chaine refuse depuis
--      trois lots. Et `video_id` la rattache a une `videos` que M3-H ne cree
--      pas — c'est M3-I qui le fera.
--
-- Enfin elle ne porte aucun index unique partiel : la concurrence que M3-H
-- doit garantir demanderait d'en ajouter un a une table deja en service.
--
-- `rendus` n'est pas davantage le bon endroit : c'est la table de PREUVE ET
-- DE FACTURATION, avec son `operation` borne a cinq valeurs et son
-- `transaction_id`. M3-H ne facture rien — il n'y ecrit donc pas.
--
-- CE QUI N'EST PAS ICI
-- ---------------------------------------------------------------------------
--
-- Ni titre, ni CTA, ni logo, ni sous-titre, ni musique, ni etalonnage, ni
-- miniature, ni publication, ni credit. M3-H RESTITUE un plan ; il n'ajoute
-- rien.
--
-- Aucune URL : la table garde un COMPARTIMENT et une CLE, comme
-- `rush_clip_sets`.
--
-- ---------------------------------------------------------------------------
-- ⚠️ NE PAS APPLIQUER EN PRODUCTION DANS CE LOT
-- ---------------------------------------------------------------------------
--
-- Le code qui la consomme degrade proprement en son absence :
-- `rendu-service.ts` traduit `42P01` et `PGRST205` en `socle_absent`, jamais
-- en « aucun rendu ». Le code peut donc etre deploye avant la migration.
--
-- DEPENDANCE D'ORDRE : la premiere instruction cree un index SUR
-- `rush_montage_plans`. Si la migration `2026-09-05-rush-montage-plans.sql`
-- n'a pas ete appliquee, elle echoue en `42P01` — `if not exists` protege
-- d'un index deja present, jamais d'une table absente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. LA GARANTIE QUI MANQUE SUR `rush_montage_plans`
-- ---------------------------------------------------------------------------
--
-- Meme geste, meme raison qu'en M3-B1 pour `rushes`, en M3-C pour les
-- analyses, en M3-F pour les jeux de candidats et en M3-G pour les jeux de
-- clips. Les index existants de `rush_montage_plans` sont la cle primaire,
-- `rush_montage_plans_identite_unique`, `rush_montage_plans_user_idx` et
-- `rush_montage_plans_jeu_idx`. Aucun ne porte le couple dont la cle
-- etrangere composite a besoin, et PostgreSQL la REFUSE sans index unique
-- correspondant.
--
-- Deux cles separees — une vers le plan, une vers l'utilisateur — seraient
-- chacune vraies sans prouver ensemble ce qu'on veut : un rendu pourrait
-- designer le plan d'autrui en annoncant son propre proprietaire, et le
-- montage d'un tiers serait rendu sous le compte du demandeur.
--
-- ⚠️ TROIS COLONNES, ET C'EST LE MEME PIEGE QU'EN M3-C ET M3-F.
--
-- Une premiere redaction n'en portait que deux, `(id, user_id)`. La cle
-- prouvait alors l'existence du plan et son proprietaire — mais RIEN ne
-- prouvait que `montage_plan_version` etait bien la version de ce plan. Une
-- version fausse, ecrite par erreur, aurait produit un rendu reussi que la
-- recherche de reutilisation n'aurait jamais retrouve : deux encodages, deux
-- fichiers, et aucun invariant viole du point de vue de la base.
--
-- La version fait partie de l'identite ; elle doit donc etre prouvee comme le
-- proprietaire l'est. Un plan etant immuable — `montage-service.ts` ne
-- l'`update` jamais — la contrainte ne peut gener aucun cas legitime.
--
-- L'index ne peut pas echouer sur un doublon : `(id, version, user_id)`
-- contient la cle primaire `id`, il est donc unique par construction.
create unique index if not exists rush_montage_plans_id_version_user_key
  on public.rush_montage_plans (id, version, user_id);

-- ---------------------------------------------------------------------------
-- 2. LES RENDUS
-- ---------------------------------------------------------------------------
create table if not exists public.rush_montage_renders (
  id uuid primary key default gen_random_uuid(),

  -- Denormalise, et garanti par la cle etrangere composite plus bas : les
  -- lectures se font par utilisateur, et une jointure a chaque controle de
  -- propriete est une occasion de l'oublier.
  user_id uuid not null references public.users(id) on delete cascade,

  montage_plan_id uuid not null,

  -- ---------------------------------------------------------------------
  -- L'IDENTITE : trois champs, et pas un de plus
  -- ---------------------------------------------------------------------
  --
  -- Elle repond a « ce fichier vient de CE plan, de CETTE version, produit
  -- avec CETTE methode ». Le plan porte DEJA, dans sa propre identite
  -- persistee, le jeu de clips et sa version, l'analyse, `m3e-v1`,
  -- `x264-crf23-v1`, `m3g-v1`, le format et la duree cible : les recopier ici
  -- les ferait exister a deux endroits, avec la certitude qu'ils
  -- divergeraient un jour.
  montage_plan_version integer not null check (montage_plan_version >= 1),

  -- ⚠️ SANS ELLE, CHANGER D'ENCODAGE SERVIRAIT L'ANCIEN FICHIER.
  --
  -- C'est la lecon que la revue de M3-F a mise au jour : `algorithme` disait
  -- comment les bornes avaient ete decidees, mais rien ne disait comment les
  -- OCTETS avaient ete produits. Un rendu reussi n'est reutilisable que si la
  -- methode est la meme.
  methode_rendu text not null check (length(methode_rendu) between 1 and 40),

  -- ---------------------------------------------------------------------
  -- L'ETAT
  -- ---------------------------------------------------------------------
  etat text not null default 'en_attente'
    check (etat in ('en_attente', 'en_cours', 'reussie', 'echouee', 'annulee')),

  -- Quatre frontieres techniques reelles, et rien de decoratif : signer et
  -- telecharger, encoder, mesurer, televerser. Nulle tant que le travail n'a
  -- pas commence.
  etape text check (etape is null
    or etape in ('source', 'encodage', 'mesure', 'televersement')),

  -- ---------------------------------------------------------------------
  -- LE RESULTAT
  -- ---------------------------------------------------------------------
  --
  -- Le fichier final tel que `ffprobe` l'a CONSTATE : compartiment, cle,
  -- octets, duree mesuree, dimensions, cadence, codecs. Vide tant que le
  -- rendu n'a pas abouti.
  --
  -- ⚠️ AUCUNE URL. Le `check` refuse tout `://` : une signature persistee
  -- serait un secret permanent en base pour un acces qui vit quelques
  -- minutes. Meme garde que `rush_clip_sets.clips` et
  -- `rush_montage_plans.plans`.
  --
  -- C'est un FIL-PIEGE, pas une frontiere, et il faut le savoir : une URL
  -- sans schema (`//hote/x`), une signature nue (`x.mp4?X-Amz-Signature=…`)
  -- ou un chemin local passeraient. La garantie reelle vient du typage et de
  -- `renduMaterialiseValide`, qui exige une cle sous le prefixe du
  -- proprietaire ; ce `check` n'attrape que l'erreur evidente.
  resultat jsonb not null default '{}'::jsonb
    check (jsonb_typeof(resultat) = 'object' and resultat::text not like '%://%'),

  -- Le vocabulaire ferme des motifs vit en TypeScript, ou il est traduit et
  -- teste. Ici, une borne de longueur : ajouter un motif ne doit pas exiger
  -- une migration, et surtout la sortie brute de ffmpeg — qui porte le chemin
  -- local et l'URL signee — ne doit jamais pouvoir y entrer.
  motif_echec text check (motif_echec is null or length(motif_echec) <= 200),

  -- Releve d'execution : durees, octets, nombre de sources. RENSEIGNE,
  -- JAMAIS DEBITE — M3-H ne facture rien.
  --
  -- ⚠️ LA MEME GARDE ANTI-URL QUE `resultat`, ET C'EST UNE DIVERGENCE ASSUMEE
  -- AVEC M3-F ET M3-G, dont les colonnes `usage` n'en portent pas.
  --
  -- La raison tient au CONTENU. Chez M3-F et M3-G, `usage` compte des clips
  -- et des secondes. Ici, le releve d'un rendu decrit un travail qui part de
  -- SOURCES SIGNEES : c'est l'endroit ou une URL atterrit naturellement quand
  -- on journalise « ce qui a ete telecharge ». Laisser le champ voisin garde
  -- et celui-ci ouvert aurait ete une invitation.
  --
  -- Les deux migrations amont sont deja appliquees en production et ne sont
  -- pas modifiees par ce lot ; la garde est posee ici, ou le risque existe.
  usage jsonb not null default '{}'::jsonb
    check (jsonb_typeof(usage) = 'object' and usage::text not like '%://%'),

  -- ⚠️ UN RENDU REUSSI PORTE UN FICHIER, SINON IL N'A PAS REUSSI.
  --
  -- Rien n'interdisait `etat = 'reussie'` avec `resultat = '{}'` : l'ecran
  -- aurait affiche un montage abouti sans rien a lire. La garde vivait en
  -- TypeScript, ou une relecture pouvait la contourner ; elle est ici.
  constraint rush_montage_renders_reussie_porte_un_fichier
    check (etat <> 'reussie' or resultat ? 'cle'),

  -- ⚠️ `created_at` EST LA DATE DE PEREMPTION, et c'est un choix.
  --
  -- `updated_at` bouge a chaque progression : un rendu mort qui aurait ecrit
  -- une derniere fois repousserait son expiration indefiniment, et le plan
  -- resterait bloque pour toujours. `started_at` est nul tant que l'etat vaut
  -- `en_attente` : un rendu jamais demarre n'expirerait alors jamais.
  -- `created_at` est le seul champ qui marque le debut de vie du travail et
  -- ne bouge plus.
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),

  -- ---------------------------------------------------------------------
  -- LA PROPRIETE, GARANTIE PAR LA BASE
  -- ---------------------------------------------------------------------
  --
  -- Elle etablit d'un coup les TROIS faits : le plan existe, il porte bien la
  -- version annoncee, et il appartient bien A CET UTILISATEUR. Aucun `if`
  -- applicatif ne peut en oublier un.
  --
  -- `on delete cascade` : un rendu est une donnee DERIVEE d'une decision
  -- elle-meme derivee. Il n'a aucune valeur propre une fois son plan disparu.
  -- Les OBJETS du stockage, eux, ne partent pas avec la ligne — leur purge
  -- est une dette assumee, comme en M3-F.
  constraint rush_montage_renders_plan_proprietaire
    foreign key (montage_plan_id, montage_plan_version, user_id)
    references public.rush_montage_plans (id, version, user_id)
    on delete cascade
);

-- ---------------------------------------------------------------------------
-- 3. LES DEUX INDEX QUI PORTENT L'IDEMPOTENCE
-- ---------------------------------------------------------------------------
--
-- ⚠️ DEUX GARANTIES DISTINCTES, PARCE QU'IL Y A DEUX RISQUES DISTINCTS.
--
-- Le premier : DEUX RENDUS QUI TOURNENT EN MEME TEMPS sur le meme plan.
-- Double clic, deux onglets, rejeu de requete, worker redemarre. Deux ffmpeg
-- partiraient sur les memes sources pour le meme resultat, et sur quatre
-- coeurs partages c'est la machine entiere qui ralentit.
--
-- La cle est le PLAN, et non l'identite complete. Un index porte sur
-- l'identite laisserait un rendu en methode v2 demarrer pendant qu'un v1
-- tourne encore : deux encodages concurrents sur les memes octets, pour un
-- benefice nul. Ce n'est pas une recopie de M3-F — c'est le meme raisonnement
-- applique a un travail dont le cout est le meme.
--
-- Partiel : les rendus TERMINES ne sont pas contraints, sans quoi un plan ne
-- pourrait jamais etre rendu deux fois.
create unique index if not exists rush_montage_renders_actif_unique
  on public.rush_montage_renders (montage_plan_id)
  where etat in ('en_attente', 'en_cours');

-- Le second : DEUX RENDUS REUSSIS PORTANT LA MEME IDENTITE.
--
-- La reutilisation d'un rendu reussi est d'abord une LECTURE ; si cette
-- lecture echouait, ou si deux requetes la franchissaient avant qu'aucune
-- n'ait ecrit, on paierait deux fois le meme encodage et deux fichiers
-- identiques occuperaient le stockage. Cet index rend la reutilisation
-- STRUCTURELLE : la base refuse le second, et l'appelant relit.
--
-- La cle est ici l'identite COMPLETE : un changement de methode doit pouvoir
-- coexister avec l'ancien rendu, puisqu'ils ne produisent pas le meme
-- fichier.
create unique index if not exists rush_montage_renders_reussi_unique
  on public.rush_montage_renders (montage_plan_id, montage_plan_version, methode_rendu)
  where etat = 'reussie';

-- La lecture de l'ecran : les rendus d'un utilisateur, les plus recents
-- d'abord.
create index if not exists rush_montage_renders_user_idx
  on public.rush_montage_renders (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. PAS DE COLONNE `version`, ET C'EST DELIBERE
-- ---------------------------------------------------------------------------
--
-- M3-F et M3-G en portent une, et il aurait ete facile de la recopier. Elle
-- n'a ici aucun invariant a defendre : les deux index partiels ci-dessus
-- couvrent le rendu concurrent ET le doublon reussi, et la cle primaire
-- distingue deja deux tentatives successives. Une colonne que rien ne lit,
-- calculee par un `select` prealable, aurait surtout apporte le risque que
-- M3-F documente — retomber silencieusement a 1 apres une panne de lecture,
-- et traduire une panne d'infrastructure en « ce rendu existe deja ».
--
-- `montage_plan_version` n'est PAS ce compteur : c'est la version DU PLAN,
-- lue dans `rush_montage_plans`, et elle appartient a l'identite.

-- ---------------------------------------------------------------------------
-- 5. AUCUN DROIT OUVERT
-- ---------------------------------------------------------------------------
--
-- Pas de `grant`. Le role qui execute cette migration possede les objets
-- qu'elle cree, et un proprietaire n'a besoin d'aucun `GRANT`.
-- Un `grant ... to public` ouvrirait la table au role anonyme de PostgREST.
--
-- ---------------------------------------------------------------------------
-- 6. APRES APPLICATION
-- ---------------------------------------------------------------------------
--
-- Recharger le cache de schema de PostgREST :
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- Sans elle, la table existe en base et reste invisible de l'API : PostgREST
-- ne relit son cache de schema qu'au demarrage.
