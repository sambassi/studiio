-- ============================================================================
-- M3-G — LES PLANS DE MONTAGE
-- ============================================================================
--
-- POURQUOI UNE TABLE, ET PAS UN CHAMP DE `rush_clip_sets`
-- ---------------------------------------------------------------------------
--
-- Le reflexe aurait ete de ranger le plan dans `rush_clip_sets.usage`, qui
-- accepte deja n'importe quel objet JSON. Deux raisons l'interdisent.
--
-- D'abord `usage` est declare « RENSEIGNE, JAMAIS DEBITE » : c'est un releve
-- d'execution, pas une decision. Son seul `check` impose un objet. Y ecrire
-- une structure dont M3-H dependra, c'est renoncer a toute contrainte de base
-- sur cette structure.
--
-- Ensuite et surtout : un meme jeu de clips doit pouvoir porter PLUSIEURS
-- plans. Un 9:16 de vingt-cinq secondes pour un reel et un 16:9 d'une minute
-- pour YouTube sont deux plans legitimes des memes octets, pas deux versions
-- du meme. Un champ unique dans la ligne du jeu l'aurait rendu impossible.
--
-- POURQUOI PAS `render_jobs`, NI `rendus`
-- ---------------------------------------------------------------------------
--
-- Le meme raisonnement qu'en M3-F, et il n'a pas change. `render_jobs` est la
-- file de rendu Remotion : `video_id`, `composition_id`, `input_props`,
-- `output_url`. Un plan de montage n'a ni video, ni composition, ni props —
-- il a un jeu de clips, un format et une liste de plans. `rendus` est la
-- table de PREUVE ET DE FACTURATION ; M3-G ne rend rien et ne facture rien,
-- il n'y ecrit donc pas. Le jour ou M3-H rendra, c'est LUI qui y reservera.
--
-- CE QUI N'EST PAS ICI
-- ---------------------------------------------------------------------------
--
-- Ni sous-titre, ni musique, ni etalonnage, ni effet, ni fondu, ni habillage,
-- ni miniature, ni publication, ni credit, ni octet. M3-G DECIDE ; il ne rend
-- rien.
--
-- Aucune URL : la table garde un COMPARTIMENT et une CLE, comme
-- `rush_clip_sets`. Une URL signee serait permanente en base alors qu'elle
-- vit quelques minutes.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. LA GARANTIE QUI MANQUE SUR `rush_clip_sets`
-- ---------------------------------------------------------------------------
--
-- Meme geste, meme raison qu'en M3-B1 pour `rushes`, en M3-C pour les
-- analyses et en M3-F pour les jeux de candidats. Les index existants de
-- `rush_clip_sets` sont la cle primaire, `rush_clip_sets_candidats_version_unique`,
-- `rush_clip_sets_active_unique`, `rush_clip_sets_user_idx` et
-- `rush_clip_sets_identite_idx`. Aucun ne porte le couple dont la cle
-- etrangere composite a besoin, et PostgreSQL la REFUSE sans index unique
-- correspondant.
--
-- Deux cles separees — une vers le jeu de clips, une vers l'utilisateur —
-- seraient chacune vraies sans prouver ensemble ce qu'on veut : un plan
-- pourrait designer le jeu de clips d'autrui en annoncant son propre
-- proprietaire, et les fichiers d'un tiers seraient montes sous le compte du
-- demandeur.
--
-- L'index ne peut pas echouer sur un doublon : `(id, user_id)` contient la
-- cle primaire `id`, il est donc unique par construction.
create unique index if not exists rush_clip_sets_id_user_key
  on public.rush_clip_sets (id, user_id);

-- ---------------------------------------------------------------------------
-- 2. LES PLANS DE MONTAGE
-- ---------------------------------------------------------------------------
create table if not exists public.rush_montage_plans (
  id uuid primary key default gen_random_uuid(),

  -- Denormalise, et garanti par la cle etrangere composite plus bas : les
  -- lectures se font par utilisateur, et une jointure a chaque controle de
  -- propriete est une occasion de l'oublier.
  user_id uuid not null references public.users(id) on delete cascade,

  clip_set_id uuid not null,

  -- ---------------------------------------------------------------------
  -- L'IDENTITE : ce qui fait qu'un plan EST le meme plan
  -- ---------------------------------------------------------------------
  --
  -- Elle repond a « ce plan a-t-il deja ete calcule ? ». Elle porte donc
  -- TOUT ce dont le resultat depend, et rien d'autre.
  clip_set_version integer not null check (clip_set_version >= 1),
  candidate_set_id uuid not null,
  analysis_id uuid not null,

  -- Herites du jeu de clips, jamais recalcules ici. `algorithme` dit comment
  -- les bornes ont ete decidees (M3-E), `methode_materialisation` comment les
  -- octets ont ete produits (M3-F). Un plan bati sur d'autres octets n'est
  -- pas le meme plan, meme si la decision de coupe est identique.
  algorithme text not null check (length(algorithme) between 1 and 40),
  methode_materialisation text not null
    check (length(methode_materialisation) between 1 and 40),

  -- Comment le PLAN a ete decide. La troisieme question, distincte des deux
  -- precedentes : « ou couper », « comment encoder », « comment monter ».
  algorithme_plan text not null check (length(algorithme_plan) between 1 and 40),

  -- ⚠️ LE FORMAT ET LA DUREE CIBLE FONT PARTIE DE L'IDENTITE.
  --
  -- Les omettre aurait rendu le premier plan calcule pour toute demande
  -- ulterieure : demander ensuite un 16:9 aurait ressorti le 9:16, sans que
  -- rien ne le signale.
  format text not null check (format in ('9:16', '1:1', '16:9')),

  -- ⚠️ EXPLICITE, TOUJOURS, ET IDENTIQUE POUR LES TROIS FORMATS.
  --
  -- Aucune duree universelle cachee : le produit n'en connait aucune
  -- (`autopilot_config` porte la cadence et les couleurs, `objectives` la
  -- plateforme et le ton, `shoot_sessions` un titre — pas une seconde). Et
  -- aucune plage par ratio : rien, dans un rapport largeur/hauteur, ne dit
  -- combien de temps une video doit durer.
  --
  -- Le plafond vient de `SET_SECONDES_MAX` de M3-F : viser plus long serait
  -- viser une duree que la chaine ne sait pas remplir.
  duree_cible_secondes numeric(10,3) not null
    check (duree_cible_secondes > 0 and duree_cible_secondes <= 120),

  version integer not null default 1 check (version >= 1),

  -- ---------------------------------------------------------------------
  -- LA CIBLE, RESOLUE
  -- ---------------------------------------------------------------------
  --
  -- Relevees depuis `VIDEO_SIZE` a la creation. Les figer rend le plan
  -- relisible meme si les constantes de l'editeur changent un jour : un plan
  -- rendu hier ne doit pas se reinterpreter tout seul.
  largeur_cible integer not null check (largeur_cible between 1 and 7680),
  hauteur_cible integer not null check (hauteur_cible between 1 and 7680),
  fps integer not null check (fps between 1 and 240),

  -- ---------------------------------------------------------------------
  -- LA DECISION
  -- ---------------------------------------------------------------------
  --
  -- La liste ordonnee des plans : ordre, rang du clip d'origine, compartiment,
  -- cle, entree, duree retenue, debut sur la timeline, rectangle de recadrage
  -- normalise, raccord entrant.
  --
  -- ⚠️ AUCUNE URL. Le `check` refuse tout `://` : une signature persistee
  -- serait un secret permanent en base pour un acces qui vit quelques
  -- minutes. Meme garde que `rush_clip_sets.clips`.
  plans jsonb not null default '[]'::jsonb
    check (jsonb_typeof(plans) = 'array' and plans::text not like '%://%'),

  -- Ce que le plan dure REELLEMENT. Avec des coupes franches, c'est
  -- exactement la somme des durees retenues.
  duree_totale_secondes numeric(10,3) not null default 0
    check (duree_totale_secondes >= 0),

  -- ⚠️ CE QUI MANQUE, EXPOSE ET JAMAIS COMBLE.
  --
  -- Ni rallongement d'un plan au-dela de son clip, ni repetition d'un clip,
  -- ni noir insere. La matiere disponible est ce qu'elle est ; le dire est la
  -- seule reponse honnete, et c'est a l'utilisateur de decider s'il tourne
  -- davantage ou vise plus court. Zero quand la cible est atteinte.
  ecart_secondes numeric(10,3) not null default 0 check (ecart_secondes >= 0),

  clips_ecartes integer not null default 0 check (clips_ecartes >= 0),

  -- Releve de decision. RENSEIGNE, JAMAIS DEBITE : M3-G ne facture rien.
  usage jsonb not null default '{}'::jsonb
    check (jsonb_typeof(usage) = 'object'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- ---------------------------------------------------------------------
  -- LA PROPRIETE, GARANTIE PAR LA BASE
  -- ---------------------------------------------------------------------
  --
  -- Elle etablit d'un coup les deux faits : le jeu de clips existe, et il
  -- appartient bien A CET UTILISATEUR. Aucun `if` applicatif ne peut
  -- l'oublier.
  --
  -- `on delete cascade` : un plan est une donnee DERIVEE d'octets eux-memes
  -- derives. Il n'a aucune valeur propre une fois ses clips disparus.
  constraint rush_montage_plans_jeu_proprietaire
    foreign key (clip_set_id, user_id)
    references public.rush_clip_sets (id, user_id)
    on delete cascade
);

-- ⚠️ L'INDEX QUI PORTE L'IDEMPOTENCE.
--
-- Une identite donnee n'existe qu'une fois. Double clic, deux onglets, rejeu
-- de requete : la base refuse le second, et l'appelant n'a aucune
-- verification a ne pas oublier. C'est ce que le `if (existant) return` ne
-- donne pas — deux requetes concurrentes passent toutes deux le `if` avant
-- que l'une n'ait ecrit.
--
-- ⚠️ M3-G N'A PAS D'ETAT ACTIF, contrairement a M3-F. Le calcul est pur et
-- synchrone : il n'y a ni travail detache a proteger, ni ligne `en_cours` a
-- perimer. L'unicite porte donc directement sur l'identite complete, et non
-- sur un etat transitoire.
create unique index if not exists rush_montage_plans_identite_unique
  on public.rush_montage_plans (clip_set_id, clip_set_version, algorithme,
                                methode_materialisation, algorithme_plan,
                                format, duree_cible_secondes);

-- La lecture de l'ecran : les plans d'un utilisateur, les plus recents d'abord.
create index if not exists rush_montage_plans_user_idx
  on public.rush_montage_plans (user_id, created_at desc);

-- Les plans d'un jeu de clips donne, tous formats confondus.
create index if not exists rush_montage_plans_jeu_idx
  on public.rush_montage_plans (clip_set_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. AUCUN DROIT OUVERT
-- ---------------------------------------------------------------------------
--
-- Pas de `grant`. Le role qui execute cette migration possede les objets
-- qu'elle cree, et un proprietaire n'a besoin d'aucun `GRANT`.
-- Un `grant ... to public` ouvrirait la table au role anonyme de PostgREST.
--
-- ---------------------------------------------------------------------------
-- 4. APRES APPLICATION
-- ---------------------------------------------------------------------------
--
-- Recharger le cache de schema de PostgREST :
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- Sans elle, la table existe en base et reste invisible de l'API : PostgREST
-- ne relit son cache de schema qu'au demarrage.
