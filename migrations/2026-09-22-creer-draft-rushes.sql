-- ============================================================================
-- CRÉER — PROTÉGER LES RUSHES D'UN BROUILLON CONTRE LA RÉTENTION DE 24 H
--
-- ⚠️ TANT QU'ELLE N'EST PAS APPLIQUÉE, la table n'existe pas : rien ne
--    change, et `draftRushKeys()` (src/lib/storage/cleanup.ts) rend `null`.
--    Le cron `/api/cron/cleanup-media` répond alors 503 sans rien supprimer —
--    comportement conservateur : on ne supprime JAMAIS ce qu'on n'a pas pu
--    lire. Les rushes continuent d'expirer comme avant ce lot une fois la
--    migration posée, mais un brouillon actif est désormais protégé.
--
-- A executer sur la base Postgres auto-hebergee (studiio-db).
--
-- UNE TABLE NOUVELLE, AUCUNE COLONNE MODIFIEE, AUCUNE DONNEE TOUCHEE.
--
-- ---------------------------------------------------------------------------
-- LE PROBLÈME QU'ELLE FERME
-- ---------------------------------------------------------------------------
--
-- Un rush importé dans Créer via la Médiathèque vit sous
-- `media/<userId>/library/<fichier>.mp4`. `getFileType` le classe `video`,
-- donc RÉTENTION 24 H (src/lib/storage/retention.ts). Il n'est référencé que
-- dans le brouillon `localStorage` du navigateur, que le serveur ne voit pas :
-- ni `scheduled_posts`, ni `autopilot_config.rush_urls` ne le connaissent. Le
-- cron le supprimait donc au bout d'un jour, l'URL du brouillon devenait 404,
-- et la séquence « Vidéo » du montage disparaissait en silence.
--
-- Cette table donne au serveur la seule chose qui lui manquait : la liste des
-- rushes qu'un brouillon utilise ACTIVEMENT, écrite par la route
-- `POST /api/creer/rush/keep` à chaque import ou re-sélection.
--
-- ---------------------------------------------------------------------------
-- POURQUOI LA CLÉ D'OBJET, ET NON L'URL
-- ---------------------------------------------------------------------------
--
-- La même ressource s'écrit de plusieurs façons — avec ou sans hôte,
-- `/public/` ou `/sign/…?token=`. La clé `<bucket>/<clé>` est ce que MinIO
-- indexe : elle est unique, et c'est exactement la forme que
-- `storageKey()` produit et que le nettoyage compare
-- (`processFile` : `cle = ` `${bucket}/${path}`). La route n'enregistre donc
-- qu'une cible de stockage APPARTENANT au compte (`cleDuCompteStrict`).
-- ============================================================================

create table if not exists public.creer_draft_rushes (
  user_id    uuid        not null,
  -- Forme `<bucket>/<clé>`, ex. `media/<userId>/library/rush.mp4`. La partie
  -- clé commence toujours par `<userId>/` (garanti par la route).
  object_key text        not null,
  -- Sert de fenêtre de fraîcheur : au-delà de 30 jours sans re-protection, le
  -- rush redevient éligible à la rétention (cf. `draftRushKeys`). `now()` à
  -- CHAQUE upsert (la route réécrit la ligne), pas seulement à la création.
  updated_at timestamptz not null default now(),
  primary key (user_id, object_key)
);

-- Le nettoyage ne lit que les entrées récentes (`updated_at > now() - 30j`).
-- Sans cet index, ce filtre balaierait toute la table à chaque passage du cron.
create index if not exists creer_draft_rushes_updated_at_idx
  on public.creer_draft_rushes (updated_at);

-- ---------------------------------------------------------------------------
-- ⚠️ DEUX ÉTAPES POST-MIGRATION — SANS ELLES, RIEN NE MARCHE (cf. CLAUDE.md)
-- ---------------------------------------------------------------------------
--
-- 1. Donner les droits au rôle PostgREST, sinon la table n'entre jamais dans
--    le cache de schéma et l'API répond « Could not find the table
--    public.creer_draft_rushes in the schema cache » :
grant all on table public.creer_draft_rushes to public;
--
-- 2. Recharger le cache de schéma de PostgREST (il ne le lit qu'au démarrage).
--    Sur le serveur, SANS arrêter le conteneur :
--
--        docker kill -s SIGUSR1 studiio-postgrest
--
-- Ces deux étapes sont à refaire après toute modification de cette table.
