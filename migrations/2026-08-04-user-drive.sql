-- Export vers Google Drive — connexion OAuth de l'utilisateur
-- A executer sur la base Postgres auto-hebergee (studiio-db).
--
-- Une seule table NOUVELLE, aucune modification de table existante : cette
-- migration ne peut pas casser l'existant.
--
-- POURQUOI UNE TABLE, ET NON `social_accounts`
--
-- `social_accounts.platform` porte une contrainte
-- `CHECK (platform IN ('instagram','tiktok','facebook','youtube'))`. Y ranger
-- 'gdrive' serait REFUSE par la base. La seule facon de reutiliser cette
-- table serait de relacher la contrainte — donc de modifier une table dont
-- depend toute la publication sociale, pour une fonctionnalite qui n'a rien
-- a voir avec elle.
--
-- Drive n'est d'ailleurs pas un reseau social : il n'a ni compte a publier,
-- ni jeton a rafraichir aux memes conditions, ni page a lier.
--
-- TANT QUE CETTE MIGRATION N'EST PAS APPLIQUEE
--
-- Le code degrade proprement : la connexion Drive refuse avec un message qui
-- nomme le fichier a appliquer, et le reste de l'application est intact —
-- aucun bouton existant ne change de comportement.

create table if not exists user_drive (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  -- Adresse du compte Google relie, affichee dans l'ecran de connexion :
  -- sans elle, l'utilisateur ne sait pas VERS QUEL Drive il envoie.
  account_email text,
  access_token text not null,
  -- Google ne renvoie un jeton de rafraichissement qu'au PREMIER
  -- consentement, et seulement avec `access_type=offline&prompt=consent`.
  -- Nullable : une reconnexion ultérieure peut n'en fournir aucun, et il
  -- faut alors conserver celui deja en base.
  refresh_token text,
  expires_at timestamptz,
  -- Portees reellement accordees. Google peut en accorder MOINS que demande
  -- (l'utilisateur decoche) : les relire evite de tenter un envoi voue a
  -- echouer en 403.
  scopes text,
  connected boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un seul Drive par utilisateur : une reconnexion remplace, elle n'empile pas.
create unique index if not exists user_drive_user_id_key on user_drive (user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- DROITS POSTGREST
--
-- Sans ce grant, PostgREST voit bien la table mais repond
-- « table not in schema cache » / 404 : le role utilise par PostgREST n'a
-- aucun droit dessus, donc la table n'entre pas dans le cache de schema.
-- ─────────────────────────────────────────────────────────────────────────
grant all on table public.user_drive to public;

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
