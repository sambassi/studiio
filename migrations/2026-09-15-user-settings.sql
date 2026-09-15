-- ============================================================================
-- USER_SETTINGS — LA TABLE QUE LE CODE LIT DEPUIS TOUJOURS, ET QUI N'EXISTAIT PAS
-- ============================================================================
--
-- Migration ADDITIVE et REJOUABLE : une table, rien d'autre. Aucune ligne
-- existante n'est touchee — il n'y en a aucune : le prevol production du
-- 2026-09-15 (`information_schema.tables`) ne trouve `user_settings` dans
-- AUCUN schema.
--
-- ---------------------------------------------------------------------------
-- 1. POURQUOI
-- ---------------------------------------------------------------------------
--
-- Trois modules ecrivent et lisent `public.user_settings` :
--
--   api/user/preferences/route.ts   creator_preferences (kit de marque,
--                                   volumes, destination d'export…)
--   api/social/settings/route.ts    social_settings
--   lib/voice/profil.ts             creator_preferences.voixPersonnelle
--                                   (choix de la voix personnelle et
--                                   prononciations — PR #397)
--
-- Les deux premiers avalent l'erreur (« table might not exist yet ») et le
-- navigateur retombe sur localStorage : la panne etait invisible. Le
-- troisieme ne peut pas : sans preferences lisibles, `resoudreVoixDuCompte`
-- echoue, donc `resoudreJumeauDuCompte` echoue, donc `/api/creer/jumeau`
-- repond 500 et le panneau « Ma voix » ne s'affiche pas. Le prevol du test
-- reel du jumeau l'a revele : `relation "public.user_settings" does not
-- exist`.
--
-- ---------------------------------------------------------------------------
-- 2. LE SCHEMA — DEDUIT DU CODE, PAS INVENTE
-- ---------------------------------------------------------------------------
--
--   user_id              uuid, cle primaire, → users(id) on delete cascade.
--                        Les trois modules font `upsert(..., { onConflict:
--                        'user_id' })` : il FAUT une contrainte d'unicite sur
--                        cette colonne, sinon PostgREST refuse l'upsert. Une
--                        ligne par compte, par construction.
--   creator_preferences  jsonb not null default '{}'. Lu par `?? {}`
--                        (profil.ts) et `|| null` (preferences) : un objet
--                        vide est un etat sain pour les deux ; le navigateur
--                        fusionne `{ ...local, ...serveur }`. NOT NULL avec
--                        defaut, parce qu'un upsert venu de `social/settings`
--                        insere une ligne SANS cette colonne.
--   social_settings      jsonb not null default '{}'. Meme raisonnement, dans
--                        l'autre sens : un upsert venu de `preferences` ou de
--                        `profil.ts` insere une ligne sans elle.
--   updated_at           timestamptz not null default now(). Les trois
--                        modules l'ecrivent a chaque upsert/update.
--
-- Pas de `created_at`, pas d'`id` : aucun module ne les lit ni ne les ecrit.
--
-- ---------------------------------------------------------------------------
-- 3. AUCUN DROIT A `public`, AUCUNE RLS — la convention en vigueur
-- ---------------------------------------------------------------------------
--
-- Comme `shoot_sessions` (2026-08-31) et `lut_assets` (2026-09-14) : la
-- migration est appliquee avec `psql -U studiio`, `studiio` possede la table,
-- un proprietaire n'a besoin d'aucun GRANT (preuve chiffree dans la migration
-- du 2026-08-31, section 3). Aucune table du projet ne porte de RLS ; en poser
-- une ici seulement serait inventer une politique.
-- ---------------------------------------------------------------------------

create table if not exists public.user_settings (
  user_id             uuid primary key references public.users(id) on delete cascade,
  creator_preferences jsonb not null default '{}'::jsonb,
  social_settings     jsonb not null default '{}'::jsonb,
  updated_at          timestamptz not null default now()
);

-- Rejouable meme si une table du meme nom a ete posee a la main avec une
-- partie des colonnes : chaque colonne est garantie, aucune n'est modifiee.
alter table public.user_settings
  add column if not exists creator_preferences jsonb not null default '{}'::jsonb;
alter table public.user_settings
  add column if not exists social_settings jsonb not null default '{}'::jsonb;
alter table public.user_settings
  add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- 4. APRES APPLICATION — ETAPE OBLIGATOIRE
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- Une NOUVELLE table reste invisible de PostgREST tant qu'il n'a pas relu
-- son cache de schema ; sans ce geste, le code continue de voir « table not
-- in schema cache » et rien n'est corrige.
--
-- CONTROLES (lecture seule) :
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'user_settings'
--    order by ordinal_position;
--   select tableowner from pg_tables where tablename = 'user_settings';
--     -- attendu : studiio
-- ---------------------------------------------------------------------------
