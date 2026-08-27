-- ═══════════════════════════════════════════════════════════════════════════
-- LE SCHEMA REEL DE PRODUCTION — celui qui a fait echouer le precontrole.
--
-- Ce fichier n'est PAS une migration : il ne sera jamais joue en production.
-- Il reconstitue ce que la base Hetzner contient VRAIMENT, et qui differe de
-- ce que le depot decrit.
--
-- `src/lib/db/migrations/002_complete_schema.sql:58` declare
-- `reference_id VARCHAR(255)` et `description TEXT`. Mais ce fichier date de
-- l'ere Supabase et contient `create policy if not exists`, une syntaxe qui
-- n'existe dans aucune version de PostgreSQL : toute execution s'interrompt
-- avant la fin. La production n'a donc jamais recu ces colonnes.
--
-- Le precontrole du 27 aout l'a etabli :
--   ERROR: column "reference_id" does not exist
--
-- D'ou ce schema : `credit_transactions` SANS `reference_id` ni
-- `description`. C'est sur lui que la migration doit savoir s'appliquer.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.users (
  id         uuid primary key,
  email      varchar(255) unique not null,
  name       varchar(255),
  credits    integer default 10,
  plan       varchar(50) default 'free',
  -- Presente en production : verifiee en lecture seule le 27 aout
  -- (text, defaut 'user', 1 compte admin, 3 comptes user, aucun NULL).
  role       text default 'user',
  created_at timestamptz default now()
);

create table if not exists public.credit_transactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  amount     integer not null,
  type       varchar(20) not null check (type in ('purchase','render','refund','bonus','subscription')),
  created_at timestamptz default now()
);

create index if not exists idx_credit_transactions_user_id on public.credit_transactions(user_id);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'role_navigateur') then
    create role role_navigateur nologin;
  end if;
end $$;

grant all on table public.users to public;
grant all on table public.credit_transactions to public;
