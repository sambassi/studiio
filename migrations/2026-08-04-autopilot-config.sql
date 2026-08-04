-- Autopilote — configuration par utilisateur
-- A executer sur la base Postgres auto-hebergee (studiio-db).
--
-- Une seule table NOUVELLE, aucune modification de table existante : cette
-- migration ne peut pas casser l'existant.
--
-- TANT QU'ELLE N'EST PAS APPLIQUEE
--
-- L'ecran de configuration le dit et reste en lecture seule ; rien n'est
-- genere, et aucun autre bouton ne change de comportement. L'Autopilote etait
-- de toute facon inactif jusqu'ici — le bouton « Activer » etait desarme.

create table if not exists autopilot_config (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  enabled boolean not null default false,
  -- 'auto'   : les montages partent sur les reseaux a l'heure prevue.
  -- 'review' : ils arrivent en brouillon, et attendent une validation.
  -- Defaut 'review' : c'est le seul choix sur quand on ne sait pas ce que
  -- l'utilisateur attend — publier sans lui demander ne se rattrape pas.
  mode text not null default 'review',
  -- 'daily' | 'every_2_days' | 'weekly'
  cadence text not null default 'weekly',
  count_per_cycle integer not null default 1,
  platforms text[] not null default '{}',
  -- Solde en dessous duquel l'Autopilote s'arrete. Sans ce plancher, il
  -- viderait le compte et l'utilisateur ne pourrait plus rien produire a la
  -- main le jour ou il en a besoin.
  credit_floor integer not null default 50,
  -- Rushes dans lesquels piocher, dans l'ordre d'ajout.
  rush_urls text[] not null default '{}',
  -- Dernier passage REELLEMENT effectue : c'est lui qui commande la cadence.
  last_run_at timestamptz,
  -- Dernier rush utilise, pour ne pas le reprendre deux fois de suite.
  last_rush_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Une seule configuration par utilisateur.
create unique index if not exists autopilot_config_user_id_key on autopilot_config (user_id);

-- Le moteur balaie les comptes actifs a chaque passage du cron.
create index if not exists autopilot_config_enabled_idx on autopilot_config (enabled) where enabled;

-- ─────────────────────────────────────────────────────────────────────────
-- DROITS POSTGREST
--
-- Sans ce grant, PostgREST voit bien la table mais repond
-- « table not in schema cache » / 404 : le role utilise par PostgREST n'a
-- aucun droit dessus, donc la table n'entre pas dans le cache de schema.
-- ─────────────────────────────────────────────────────────────────────────
grant all on table public.autopilot_config to public;

-- ─────────────────────────────────────────────────────────────────────────
-- ⚠️ APRES CETTE MIGRATION — ETAPE OBLIGATOIRE
--
--     docker kill -s SIGUSR1 studiio-postgrest
--
-- Cette commande ne redemarre PAS le conteneur : elle demande a PostgREST de
-- relire le schema. A refaire apres CHAQUE migration qui cree ou modifie une
-- table, sinon la table reste invisible et l'API repond 404.
-- ─────────────────────────────────────────────────────────────────────────
