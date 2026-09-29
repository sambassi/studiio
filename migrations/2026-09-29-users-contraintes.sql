-- ═══════════════════════════════════════════════════════════════════════════
-- USERS — contraintes d'identite indispensables au lancement.
--
-- PREPAREE, PAS APPLIQUEE. Ordre imperatif en production :
--   0. deployer D'ABORD le code de src/lib/auth/config.ts de ce lot (rattrapage
--      casse-insensible) : sans lui, apres l'index, une connexion avec une
--      variante de casse verrait son INSERT refuse et bouclerait sans compte ;
--   1. `2026-09-29-users-contraintes.diagnostic.sql` (lecture seule) ;
--   2. si ses requetes 1 a 4 renvoient 0 ligne → cette migration ;
--   3. `grant` inutile (aucune table creee), mais recharger PostgREST
--      (`docker kill -s SIGUSR1 studiio-postgrest`) : une colonne peut avoir
--      ete ajoutee a `users`.
-- Rollback : `2026-09-29-users-contraintes.rollback.sql`.
--
-- ─────────────────────────────────────────────────────────────────────────
-- CONSTATS (audit du 29 septembre)
-- ─────────────────────────────────────────────────────────────────────────
-- * `users.email varchar(255) unique not null` (001_initial_schema.sql,
--   reproduit dans tests-pg/schema-production.sql) : l'unicite est SENSIBLE
--   A LA CASSE et aux espaces. `Coach@x.com` et `coach@x.com` coexistent.
-- * La creation de compte (src/lib/auth/config.ts, resolveSupabaseUserId)
--   cherchait par `.eq('email', …)` exact puis INSERT : un meme humain venu
--   par Google puis par Facebook avec une casse differente obtenait un
--   second compte a 10 credits.
-- * `users.stripe_customer_id` est lu/ecrit par create-checkout,
--   create-portal et credits/purchase-pack (ecriture dans un try/catch muet),
--   mais n'est declare dans AUCUNE migration du depot (002 ne le met que sur
--   `subscriptions`, ou il n'est volontairement PAS unique : un client Stripe
--   peut avoir plusieurs abonnements successifs). Son existence en
--   production n'est pas prouvee → ajout conditionnel, nullable, sans defaut.
-- * `credits >= 0` : deja pose (NOT VALID) par 2026-08-27-credits-atomiques.
-- * `plan` : AUCUN check ajoute. Les cles viennent de la table `plans`
--   (webhook Stripe, planFromPriceId) ; figer une liste ici casserait le
--   webhook le jour ou un plan est ajoute en base.
--
-- ─────────────────────────────────────────────────────────────────────────
-- SURETE
-- ─────────────────────────────────────────────────────────────────────────
-- * Aucune ligne n'est modifiee, supprimee ni fusionnee. Jamais.
-- * Garde explicite : s'il existe des doublons, la transaction ECHOUE avec
--   un message qui les compte. Rien n'est cree a moitie (begin/commit).
-- * CREATE INDEX non CONCURRENTLY : `users` compte une poignee de lignes ;
--   le verrou SHARE (ecritures bloquees) dure quelques millisecondes. En
--   echange la migration reste une transaction unique, rejouable, testee
--   telle quelle sur un vrai PostgreSQL (tests-pg/users-contraintes.pg.test.ts).
-- * Rejouable : `if not exists` partout.
--
-- ─────────────────────────────────────────────────────────────────────────
-- SI LE DIAGNOSTIC TROUVE DES DOUBLONS — PROCEDURE MANUELLE, JAMAIS AUTOMATIQUE
-- ─────────────────────────────────────────────────────────────────────────
-- 1. Sauvegarde fraiche de `studiio-db` (pas celle de 03h00).
-- 2. Pour chaque groupe de la requete 1 : choisir le compte a garder avec le
--    proprietaire (en general : le plus ancien / celui qui a des credits,
--    un abonnement, des posts). Ne rien deviner.
-- 3. Reaffecter a ce compte, table par table, les lignes filles du doublon
--    (`scheduled_posts`, `videos`, `credit_transactions`, `subscriptions`,
--    `social_accounts`, `rendus`, …) dans UNE transaction, en comptant les
--    lignes avant/apres. La route admin `/api/admin/cleanup-duplicates`
--    existe mais n'a pas ete re-auditee : ne pas s'y fier sans relecture.
-- 4. Reporter a la main les credits si le proprietaire le demande, avec une
--    ligne `credit_transactions` de type `bonus` qui le trace.
-- 5. Seulement ensuite supprimer le doublon, relancer le diagnostic (0
--    ligne), puis cette migration.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- 1. La colonne que le code utilise deja. Aucun effet si elle existe.
alter table public.users
  add column if not exists stripe_customer_id text;

-- 2. Garde : refus explicite plutot qu'un index a moitie cree ou, pire, une
--    fusion silencieuse.
do $$
declare
  v_doublons_email  integer;
  v_email_vides     integer;
  v_doublons_stripe integer;
begin
  select count(*) into v_doublons_email from (
    select 1 from public.users
     group by lower(btrim(email)) having count(*) > 1
  ) d;

  select count(*) into v_email_vides
    from public.users where btrim(email) = '';

  select count(*) into v_doublons_stripe from (
    select 1 from public.users
     where stripe_customer_id is not null
     group by stripe_customer_id having count(*) > 1
  ) d;

  if v_doublons_email > 0 or v_email_vides > 0 or v_doublons_stripe > 0 then
    raise exception
      'users-contraintes : migration refusee — % groupe(s) d''e-mails en double (casse/espaces), % e-mail(s) vide(s), % stripe_customer_id en double. Aucune donnee modifiee. Lancer 2026-09-29-users-contraintes.diagnostic.sql puis la procedure manuelle.',
      v_doublons_email, v_email_vides, v_doublons_stripe;
  end if;
end $$;

-- 3. Un seul compte par adresse, casse et espaces de bord ignores.
--    L'ancienne contrainte `users_email_key` (exacte) est conservee.
create unique index if not exists users_email_lower_unique
  on public.users (lower(btrim(email)));

-- 4. E-mail non vide. Les lignes existantes sont deja verifiees par la garde.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'users_email_non_vide'
       and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_email_non_vide check (btrim(email) <> '');
  end if;
end $$;

-- 5. Un client Stripe ne peut appartenir qu'a un compte. Plusieurs NULL
--    (comptes sans paiement) restent permis.
create unique index if not exists users_stripe_customer_id_unique
  on public.users (stripe_customer_id)
  where stripe_customer_id is not null;

commit;
