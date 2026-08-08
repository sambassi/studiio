-- Publication réseaux pour les UTILISATEURS, via Zernio (marque blanche).
--
-- ⚠️ DEUX DRAPEAUX, ET LES DEUX A `false` PAR DEFAUT. Rien ne change pour
-- personne tant que l'administrateur n'a pas ouvert l'interrupteur global ET
-- que l'utilisateur n'a pas l'option. L'administrateur, lui, garde ses
-- integrations directes existantes (`/api/social/*`) : Zernio est un chemin de
-- PLUS, pas un remplacement.
--
-- ⚠️ LE PROFIL ZERNIO EST FACTURE. Il n'est donc cree qu'au moment ou
-- l'utilisateur active l'option — jamais a l'inscription. D'ou la colonne
-- nullable plutot qu'un provisionnement de masse.

alter table public.users
  add column if not exists zernio_profile_id  text,
  add column if not exists publishing_enabled boolean not null default false;

-- Comptes reseau connectes via Zernio. Peuple par le webhook
-- `account.connected` ET par le retour de connexion, qui porte deja
-- `accountId`/`username` : deux chemins pour la meme verite, d'ou la cle
-- unique sur `account_id` qui rend l'ecriture idempotente.
create table if not exists public.zernio_accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  profile_id  text not null,
  account_id  text not null unique,
  platform    text not null,
  username    text,
  -- 'connected' | 'disconnected' — l'ecran propose « Reconnecter » sur le second.
  status      text not null default 'connected',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists zernio_accounts_user_idx on public.zernio_accounts(user_id);
-- Le webhook n'a que le `profileId` pour retrouver le proprietaire.
create index if not exists zernio_accounts_profile_idx on public.zernio_accounts(profile_id);

-- Interrupteur global — le coupe-circuit de l'administrateur.
create table if not exists public.site_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

-- ⚠️ `false` : sans cette ligne, l'absence de reglage serait lue comme
-- « ouvert », et la publication s'activerait pour tout le monde au premier
-- deploiement.
insert into public.site_settings(key, value) values ('user_publishing_enabled', 'false')
  on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- DROITS POSTGREST
--
-- Sans ce grant, PostgREST voit les tables mais repond « table not in schema
-- cache » / 404 : le role qu'il utilise n'a aucun droit dessus.
-- ─────────────────────────────────────────────────────────────────────────
grant all on table public.users to public;
grant all on table public.zernio_accounts to public;
grant all on table public.site_settings to public;

-- ─────────────────────────────────────────────────────────────────────────
-- ⚠️ APRES CETTE MIGRATION — ETAPE OBLIGATOIRE
--
--     docker kill -s SIGUSR1 studiio-postgrest
--
-- PostgREST met son schema en cache au demarrage : tant qu'il n'est pas
-- recharge, les colonnes et tables ajoutees restent invisibles.
-- ─────────────────────────────────────────────────────────────────────────
