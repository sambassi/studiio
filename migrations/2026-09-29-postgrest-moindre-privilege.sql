-- ═══════════════════════════════════════════════════════════════════════════
-- POSTGREST — MOINDRE PRIVILEGE
--
-- ⚠️ NE PAS APPLIQUER SANS LE RUNBOOK : docs/runbook-postgrest-moindre-privilege.md
--    (staging d'abord, sauvegarde, puis bascule des variables PostgREST).
--
-- LE CONSTAT (depuis le depot, cf. tests-pg/lut-assets.pg.test.ts §0b et la
-- memoire « securite-gate-staging ») : `studiio` est a la fois
--   - l'utilisateur de connexion de PostgREST (PGRST_DB_URI),
--   - le role anonyme (PGRST_DB_ANON_ROLE=studiio),
--   - le role porte par le JWT serveur (claim `role=studiio`),
--   - le proprietaire des tables et un SUPERUSER.
-- Toute requete SANS jeton qui atteint PostgREST s'execute donc en
-- superutilisateur : lecture et ecriture de `users` (credits, role),
-- `subscriptions`, `credit_transactions`, `social_accounts` (jetons OAuth)…
--
-- CE QUE L'APPLICATION UTILISE REELLEMENT (audit du code, 2026-09-29) :
--   - AUCUN appel PostgREST depuis le navigateur. Aucun composant
--     'use client' n'importe `@/lib/db/supabase` ni `@supabase/supabase-js`.
--     Le client `supabase` (cle anon) n'est importe nulle part.
--   - Tout passe par `supabaseAdmin` (routes API, crons, lib serveur) avec
--     SUPABASE_SERVICE_KEY (ou SUPABASE_SERVICE_ROLE_KEY).
--   => le role anonyme n'a besoin d'AUCUN droit.
--
-- LE MODELE CIBLE (standard PostgREST) :
--
--   authenticator  LOGIN (mot de passe pose HORS migration) NOINHERIT,
--                  aucun droit propre. C'est l'utilisateur de PGRST_DB_URI.
--                  Il ne peut QUE basculer (SET ROLE) vers :
--     ├─ web_anon     NOLOGIN, aucun droit, pas meme USAGE sur le schema.
--     │               = PGRST_DB_ANON_ROLE. Requete sans jeton → 401.
--     └─ service_role NOLOGIN, BYPASSRLS, DML (select/insert/update/delete)
--                     sur les tables de `public`, EXECUTE sur ses fonctions.
--                     = claim `role` du NOUVEAU JWT serveur.
--                     Ni superuser, ni DDL, ni TRUNCATE, ni autre schema,
--                     ni COPY PROGRAM, ni creation de role.
--
--   Le nom `service_role` est celui qu'attendent les migrations Stripe
--   (stripe_events : EXECUTE de stripe_event_claim/complete/fail et
--   crediter_credits_stripe accorde a `service_role` « s'il existe »). Quel
--   que soit l'ordre d'application, ces fonctions lui sont ouvertes : avant
--   cette migration → section 4 ; apres → privileges par defaut (section 5).
--
--   `studiio` reste le proprietaire et le role des migrations
--   (`psql -U studiio`). authenticator n'en est PAS membre : un jeton qui
--   porterait encore `role=studiio` est refuse.
--
-- POURQUOI DML SUR TOUTES LES TABLES, et pas une liste table par table :
-- service_role est l'identite du backend tout entier (comme le
-- `service_role` de Supabase). Le code touche ~40 tables ; une liste figee
-- casserait en silence la prochaine table ajoutee. Le gain de securite est
-- ailleurs : passer de superuser a DML-sans-DDL, et surtout fermer l'anonyme.
--
-- POURQUOI BYPASSRLS : `studiio` (superuser) ignore aujourd'hui toute RLS.
-- Si une table heritee de l'ere Supabase a la RLS activee, un role sans
-- BYPASSRLS y lirait 0 ligne, sans erreur. BYPASSRLS garde le comportement
-- actuel (regle « default safe »). La securite ne repose PAS sur la RLS :
-- l'anonyme n'a rien.
--
-- POURQUOI REVOQUER USAGE SUR LE SCHEMA A PUBLIC : 23 migrations du depot
-- font `grant all on table ... to public` (CLAUDE.md le recommandait). Un
-- tel grant donne la table a TOUT role, y compris web_anon. Sans USAGE sur
-- le schema, web_anon ne peut plus rien atteindre dans `public`, meme si
-- une future migration refait l'erreur. C'est la defense en profondeur qui
-- rend la regle robuste.
--
-- CETTE MIGRATION NE CHANGE RIEN A L'APPLICATION TANT QUE PostgREST N'EST
-- PAS BASCULE : `studiio` est superuser, les revocations ne le concernent
-- pas. Elle peut donc etre appliquee avant la bascule, sans coupure.
--
-- Rejouable. Rollback : migrations/2026-09-29-postgrest-moindre-privilege.rollback.sql
-- Verification (lecture seule) : migrations/2026-09-29-postgrest-moindre-privilege.verif.sql
-- Tests : tests-pg/postgrest-moindre-privilege.pg.test.ts
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ---------------------------------------------------------------------------
-- 0. GARDE-FOU : seul un superuser peut poser BYPASSRLS et gerer les roles.
--    En production c'est `studiio`. Un autre role echouerait a mi-chemin.
-- ---------------------------------------------------------------------------
do $$
begin
  if not (select rolsuper from pg_roles where rolname = current_user) then
    raise exception 'postgrest-moindre-privilege : a jouer en superuser (studiio), pas en %', current_user;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. LES ROLES
--    Crees s'ils manquent, puis leurs attributs sont FORCES : si un role du
--    meme nom existait deja (restauration d'un dump Supabase par exemple), il
--    ne garde aucun attribut dangereux.
--    authenticator est cree NOLOGIN : son mot de passe est un secret, il est
--    pose a la main (runbook, `\password authenticator`) puis LOGIN active.
--    Rejouer la migration ne touche plus a LOGIN/NOLOGIN d'authenticator.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'web_anon') then
    create role web_anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator nologin noinherit;
  end if;
end $$;

alter role web_anon      nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
alter role service_role   nologin nosuperuser nocreatedb nocreaterole noreplication bypassrls;
alter role authenticator noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;

-- authenticator ne doit pouvoir basculer QUE vers ces deux roles.
grant web_anon    to authenticator;
grant service_role to authenticator;

-- Et surtout pas vers un role privilegie : on retire toute appartenance
-- d'authenticator a un superuser (dont `studiio`) qui aurait ete posee a la main.
do $$
declare r record;
begin
  for r in
    select g.rolname
      from pg_auth_members m
      join pg_roles g on g.oid = m.roleid
      join pg_roles u on u.oid = m.member
     where u.rolname = 'authenticator'
       and (g.rolsuper or g.rolname not in ('web_anon', 'service_role'))
  loop
    execute format('revoke %I from authenticator', r.rolname);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. LE SCHEMA : plus rien pour PUBLIC (donc pour web_anon).
-- ---------------------------------------------------------------------------
revoke create on schema public from public;
revoke usage  on schema public from public;
grant  usage  on schema public to service_role;

-- ---------------------------------------------------------------------------
-- 3. NETTOYAGE des grants a PUBLIC poses par les migrations anterieures
--    (`grant all on table ... to public`), et de ceux d'eventuels roles
--    herites de Supabase (`anon`, `authenticated`), s'ils existent.
--    Les fonctions : PostgreSQL donne EXECUTE a PUBLIC par defaut ; les
--    fonctions sensibles le retiraient deja une a une, on le retire a toutes.
-- ---------------------------------------------------------------------------
revoke all on all tables    in schema public from public;
revoke all on all sequences in schema public from public;
revoke all on all routines  in schema public from public;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables    in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all routines  in schema public from %I', r);
      execute format('revoke all on schema public from %I', r);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. LE ROLE SERVEUR : DML + sequences + fonctions. Rien d'autre.
--    Les fonctions SECURITY DEFINER (debiter_credits, confirmer_rendu,
--    clore_rendu, confirmer_rendu_sans_debit, debiter_credits_operation,
--    lut_assets_ajouter) restent fermees a PUBLIC et s'ouvrent a service_role.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on all tables    in schema public to service_role;
grant usage, select                  on all sequences in schema public to service_role;
grant execute                        on all routines  in schema public to service_role;

-- ---------------------------------------------------------------------------
-- 5. LES TABLES FUTURES (stripe_events, pawapay_deposits, …)
--    Privileges par defaut du role qui joue les migrations (current_user,
--    `studiio` en production) : toute table/fonction qu'il creera ensuite
--    dans `public` sera ouverte a service_role et fermee a PUBLIC, SANS grant
--    dans la migration. Seul `docker kill -s SIGUSR1 studiio-postgrest`
--    reste necessaire.
--    Le retrait d'EXECUTE a PUBLIC ne peut se faire qu'au niveau global (pas
--    `in schema`) : c'est une regle de PostgreSQL.
-- ---------------------------------------------------------------------------
alter default privileges revoke execute on routines from public;
alter default privileges in schema public grant select, insert, update, delete on tables    to service_role;
alter default privileges in schema public grant usage, select                  on sequences to service_role;
alter default privileges in schema public grant execute                        on routines  to service_role;

commit;

-- ---------------------------------------------------------------------------
-- APRES APPLICATION
--   docker kill -s SIGUSR1 studiio-postgrest
--   puis : migrations/2026-09-29-postgrest-moindre-privilege.verif.sql
--   puis la bascule des variables (runbook, etapes 4 a 7).
-- ---------------------------------------------------------------------------
