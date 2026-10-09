-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — POSTGREST MOINDRE PRIVILEGE
--
-- ⚠️ ORDRE IMPERATIF : ce script ne se joue qu'APRES avoir remis PostgREST
-- et l'application sur l'ancienne configuration (runbook, section Rollback) :
--   studiio-postgrest : PGRST_DB_URI et PGRST_DB_ANON_ROLE a leurs valeurs
--                       d'avant (conservees a l'etape 0), redemarrage ;
--   studiio-app       : SUPABASE_SERVICE_KEY a l'ancienne valeur, redeploiement.
-- Tant que PostgREST se connecte en `authenticator`, supprimer ce role le
-- coupe net.
--
-- Dans la plupart des cas, le rollback de CONFIGURATION suffit : `studiio`
-- est superuser, les revocations de la migration ne le genent pas. Ce script
-- ne sert qu'a effacer les roles et les privileges par defaut si l'on
-- renonce definitivement au chantier.
--
-- Ce qu'il NE restaure PAS, volontairement : les `grant all ... to public`
-- des tables. Ils n'ont jamais servi a l'application (studiio est
-- superuser) et ne feraient que rouvrir la faille a tout futur role non
-- privilegie. Si une restauration a l'identique est exigee, rejouer les
-- lignes `grant ... to public` sauvegardees par la section « instantane »
-- du script de verification (etape 0 du runbook).
--
-- A jouer en superuser (`psql -U studiio`). Rejouable.
-- ═══════════════════════════════════════════════════════════════════════════

-- NON annule, volontairement (ajouts du 2026-10-10) :
--   - le search_path fige des fonctions SECURITY DEFINER : sans effet sur
--     l'application, il ne fait que fermer un detournement de nom ;
--   - les attributs forces des roles herites `anon` / `authenticated` :
--     l'instantane de l'etape 0 (verif.sql, section A) les conserve.
begin;

-- 1. Le schema redevient utilisable par tous, comme avant.
grant usage on schema public to public;

-- 2. Les fonctions creees ensuite retrouvent l'EXECUTE a PUBLIC par defaut
--    (comportement natif de PostgreSQL). Les fonctions sensibles le retirent
--    elles-memes dans leur migration.
alter default privileges grant execute on routines to public;

-- 3. Les privileges par defaut accordes a service_role.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    alter default privileges in schema public revoke select, insert, update, delete on tables    from service_role;
    alter default privileges in schema public revoke usage, select                  on sequences from service_role;
    alter default privileges in schema public revoke execute                        on routines  from service_role;
  end if;
end $$;

-- 4. Les roles. DROP OWNED retire leurs privileges (ils ne possedent rien).
--    DROP OWNED / DROP ROLE ne valent que pour la base courante : si le
--    cluster porte d'autres bases ou ces roles ont des droits, DROP ROLE
--    echouera et le signalera — c'est voulu.
do $$
declare r text;
begin
  foreach r in array array['authenticator', 'service_role', 'web_anon'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('drop owned by %I', r);
      execute format('drop role %I', r);
    end if;
  end loop;
end $$;

commit;

-- Puis : docker kill -s SIGUSR1 studiio-postgrest
