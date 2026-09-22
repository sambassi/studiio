-- ============================================================================
-- AUTOPILOTE — MONTER LA VIDÉO DU JUMEAU, SANS NAVIGATEUR
--
-- Deux ajouts, aucune colonne existante modifiée, aucune donnée touchée :
--
--   1. `autopilot_config.jumeau_avatar` — le réglage « utiliser la vidéo de
--      mon jumeau ». FAUX par défaut : aucune configuration existante ne se
--      met à générer un avatar (facturé) sans l'avoir demandé. Tant que la
--      colonne n'existe pas, `sanitizeConfig` la lit `undefined` → faux.
--
--   2. `autopilot_jumeau_attente` — la FILE des montages en attente de leur
--      jumeau. La génération D-ID prend 5 à 20 min ; la requête d'Autopilote
--      est bornée à 300 s et n'a pas de navigateur pour attendre. Le montage
--      est donc DÉCOUPLÉ : on LANCE la génération et on dépose une ligne ici ;
--      un finaliseur (le cron) la reprend quand la vidéo est prête, puis rend.
--
--      `unique (user_id, slot_key)` = un seul montage par créneau, même si le
--      cron repasse : c'est l'idempotence du lancement. `statut` claim atomique
--      (`en_attente` → `en_cours`) empêche deux finaliseurs de rendre deux fois.
--      `snapshot` porte de quoi rendre plus tard exactement le même montage
--      (config, post, rang, instant) — le rendu ne dépend d'aucun état vivant.
--
-- A executer sur la base Postgres auto-hebergee (studiio-db).
-- ============================================================================

alter table public.autopilot_config
  add column if not exists jumeau_avatar boolean not null default false;

create table if not exists public.autopilot_jumeau_attente (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null,
  -- La génération d'avatar lancée (avatar_generations.id) que l'on attend.
  generation_id uuid        not null,
  -- Un montage par créneau : rejoue-proof. Le cron peut repasser, il ne
  -- relancera pas un créneau déjà en file.
  slot_key      text        not null,
  -- Référence de débit du RENDU (idempotente) : un rendu rejoué ne débite pas
  -- deux fois — c'est `produireUnMontage` qui la porte.
  job_id        text        not null,
  -- en_attente → en_cours (claim) → rendu | echec.
  statut        text        not null default 'en_attente',
  -- De quoi rendre le MÊME montage plus tard : { config, post, rang, now }.
  snapshot      jsonb       not null,
  -- Rempli à la finalisation.
  post_id       uuid,
  -- Raison d'un échec (génération D-ID en échec, délai dépassé…).
  motif         text,
  -- Nombre de passes de finalisation déjà tentées (garde-fou anti-boucle).
  tentatives    int         not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, slot_key)
);

-- Le finaliseur balaie les lignes ENCORE ouvertes, les plus vieilles d'abord.
create index if not exists autopilot_jumeau_attente_statut_idx
  on public.autopilot_jumeau_attente (statut, created_at);

-- ---------------------------------------------------------------------------
-- ⚠️ DEUX ÉTAPES POST-MIGRATION — SANS ELLES, RIEN NE MARCHE (cf. CLAUDE.md)
-- ---------------------------------------------------------------------------
--
-- 1. Droits au rôle PostgREST, sinon la table n'entre pas dans le cache de
--    schéma (« Could not find the table … in the schema cache ») :
grant all on table public.autopilot_jumeau_attente to public;
--
-- 2. Recharger le cache de schéma de PostgREST (lu au démarrage seulement) :
--
--        docker kill -s SIGUSR1 studiio-postgrest
--
-- (La colonne `jumeau_avatar` d'une table DÉJÀ dans le cache est visible après
--  le même SIGUSR1 ; le `grant` de la table existante est déjà en place.)
