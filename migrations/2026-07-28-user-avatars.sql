-- F4b — Avatar video parlant (HeyGen)
-- A executer sur la base Postgres auto-hebergee (studiio-db).
--
-- Deux tables, aucune modification de table existante : cette migration ne
-- peut pas casser l'existant.

-- Avatar HeyGen d'un utilisateur (photo source + consentement).
create table if not exists user_avatars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null default 'heygen',
  -- Identifiant de l'avatar chez le fournisseur (avatar_id HeyGen v3).
  provider_avatar_id text not null,
  provider_asset_id text,
  name text,
  -- 'processing' | 'completed' | 'failed' — etat d'entrainement chez HeyGen.
  status text not null default 'processing',
  -- URL de l'image source re-hebergee sur notre stockage (MinIO).
  source_url text,
  -- Consentement obligatoire : l'utilisateur certifie etre la personne
  -- represensee. Sans ces champs, aucune generation n'est autorisee.
  consent_at timestamptz not null,
  consent_text text not null,
  created_at timestamptz not null default now()
);

create index if not exists user_avatars_user_id_idx
  on user_avatars (user_id, created_at desc);

-- Une generation de video = un appel facture a HeyGen.
create table if not exists avatar_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  user_avatar_id uuid not null references user_avatars(id) on delete cascade,
  provider_video_id text,
  script text not null,
  voice_id text,
  aspect_ratio text not null default '9:16',
  -- 'pending' | 'processing' | 'completed' | 'failed'
  status text not null default 'pending',
  -- URL finale sur notre stockage (MinIO), pas l'URL HeyGen (qui expire).
  video_url text,
  duration_seconds numeric,
  credits_charged integer not null default 0,
  -- Passe a true quand un echec a donne lieu au remboursement des credits.
  credits_refunded boolean not null default false,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists avatar_generations_user_id_idx
  on avatar_generations (user_id, created_at desc);

create index if not exists avatar_generations_status_idx
  on avatar_generations (status);

-- ─────────────────────────────────────────────────────────────────────────
-- DROITS POSTGREST
--
-- Sans ce grant, PostgREST voit bien la table mais repond
-- « table not in schema cache » / 404 : le role utilise par PostgREST n'a
-- aucun droit dessus, donc la table n'entre pas dans le cache de schema.
-- ─────────────────────────────────────────────────────────────────────────
grant all on table public.user_avatars, public.avatar_generations to public;

-- ─────────────────────────────────────────────────────────────────────────
-- ⚠️ APRES CETTE MIGRATION — ETAPE OBLIGATOIRE
--
-- PostgREST met son schema en cache au demarrage. Tant qu'il n'est pas
-- recharge, toute table fraichement creee reste invisible et l'API renvoie
-- « Could not find the table ... in the schema cache ».
--
-- Recharger le cache (sur le serveur Hetzner) :
--
--     docker kill -s SIGUSR1 studiio-postgrest
--
-- Cette commande ne redemarre PAS le conteneur : elle demande juste a
-- PostgREST de relire le schema. A refaire apres CHAQUE migration qui cree
-- ou modifie une table, sinon le bug se reproduira a l'identique.
-- ─────────────────────────────────────────────────────────────────────────
