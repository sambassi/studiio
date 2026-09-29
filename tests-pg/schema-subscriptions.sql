-- ═══════════════════════════════════════════════════════════════════════════
-- SCHEMA PREALABLE `subscriptions` — pour la base ephemere de la CI, et elle seule.
--
-- Ce fichier n'est PAS une migration. Il recopie fidelement la definition de
-- `src/lib/db/migrations/002_complete_schema.sql:67-79` (contrainte inline,
-- donc nommee `subscriptions_status_check` par PostgreSQL). Il suppose
-- `public.users` deja cree par `schema-prealable.sql`.
--
-- Le schema REEL de cette table en production n'a pas ete releve : les tests
-- couvrent donc aussi une contrainte d'un autre nom et l'absence de
-- contrainte (voir `subscriptions-status.pg.test.ts`).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  plan varchar(20) not null check (plan in ('starter', 'pro', 'enterprise')),
  status varchar(20) not null default 'active' check (status in ('active', 'canceled', 'expired', 'past_due')),
  stripe_subscription_id varchar(255) unique,
  stripe_customer_id varchar(255),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
