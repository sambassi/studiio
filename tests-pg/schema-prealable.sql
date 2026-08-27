-- ═══════════════════════════════════════════════════════════════════════════
-- SCHEMA PREALABLE MINIMAL — pour la base ephemere de la CI, et elle seule.
--
-- Ce fichier n'est PAS une migration : il ne sera jamais joue en production.
-- Il reconstitue le strict minimum sur lequel la vraie migration s'applique,
-- copie fidelement depuis `src/lib/db/migrations/001_initial_schema.sql:2` et
-- `002_complete_schema.sql:12,52-64`.
--
-- Pourquoi ne pas rejouer `002_complete_schema.sql` tel quel : il contient
-- `CREATE POLICY IF NOT EXISTS`, une syntaxe qui n'existe dans AUCUNE version
-- de PostgreSQL, et des appels a `auth.uid()`, fonction du schema `auth` de
-- Supabase, absent d'un Postgres nu. Le rejouer echouerait avant d'arriver
-- aux credits.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.users (
  id         uuid primary key,
  email      varchar(255) unique not null,
  name       varchar(255),
  credits    integer default 10,
  plan       varchar(50) default 'free',
  created_at timestamptz default now()
);

create table if not exists public.credit_transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  amount       integer not null,
  type         varchar(20) not null check (type in ('purchase','render','refund','bonus','subscription')),
  reference_id varchar(255),
  description  text,
  created_at   timestamptz default now()
);

create index if not exists idx_credit_transactions_user_id on public.credit_transactions(user_id);
create index if not exists idx_credit_transactions_created_at on public.credit_transactions(created_at desc);

-- Role qui tient lieu de « navigateur » dans les tests de droits : il a les
-- memes droits de table que le role PostgREST du depot
-- (`grant all on table public.users to public`, migrations/2026-08-08-zernio.sql:57).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'role_navigateur') then
    create role role_navigateur nologin;
  end if;
end $$;

grant all on table public.users to public;
grant all on table public.credit_transactions to public;
