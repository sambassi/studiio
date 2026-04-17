-- Pricing tables with Stripe integration
-- Run in Supabase SQL editor

create table if not exists plans (
  key text primary key,
  name text not null,
  price_cents int not null default 0,
  yearly_price_cents int default 0,
  credits int not null default 0,
  features jsonb default '[]'::jsonb,
  stripe_product_id text,
  stripe_price_id text,
  stripe_yearly_price_id text,
  watermark boolean default false,
  max_socials int default 999,
  popular boolean default false,
  active boolean default true,
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists credit_packs (
  key text primary key,
  name text not null,
  amount int not null default 0,
  price_cents int not null default 0,
  stripe_product_id text,
  stripe_price_id text,
  popular boolean default false,
  active boolean default true,
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Add columns if tables already exist (idempotent)
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name='plans' and column_name='stripe_product_id') then
    alter table plans add column stripe_product_id text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='plans' and column_name='stripe_price_id') then
    alter table plans add column stripe_price_id text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='plans' and column_name='stripe_yearly_price_id') then
    alter table plans add column stripe_yearly_price_id text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='credit_packs' and column_name='stripe_product_id') then
    alter table credit_packs add column stripe_product_id text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='credit_packs' and column_name='stripe_price_id') then
    alter table credit_packs add column stripe_price_id text;
  end if;
end $$;

-- Partial indexes for price lookups
create index if not exists idx_plans_stripe_price on plans (stripe_price_id) where stripe_price_id is not null;
create index if not exists idx_plans_stripe_yearly on plans (stripe_yearly_price_id) where stripe_yearly_price_id is not null;
create index if not exists idx_packs_stripe_price on credit_packs (stripe_price_id) where stripe_price_id is not null;
