-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION — POSTGREST MOINDRE PRIVILEGE — LECTURE SEULE
--
-- Aucune ecriture : uniquement des SELECT sur les catalogues. Aucun secret
-- n'est lu ni affiche (ni mot de passe, ni jeton).
-- Utilisable AVANT la migration (instantane, etape 0 du runbook) et APRES
-- (controle, etape 3). La transaction est ouverte en READ ONLY : une
-- ecriture accidentelle serait refusee par PostgreSQL.
--
--   psql -U studiio -d studiio -v ON_ERROR_STOP=1 \
--        -f migrations/2026-09-29-postgrest-moindre-privilege.verif.sql
-- ═══════════════════════════════════════════════════════════════════════════

begin transaction read only;

\echo '== A. Roles (attendu apres migration : service_role bypassrls, aucun des trois superuser) =='
select rolname, rolsuper, rolcanlogin, rolinherit, rolbypassrls, rolcreaterole, rolcreatedb
  from pg_roles
 where rolname in ('studiio', 'authenticator', 'web_anon', 'service_role',
                   'anon', 'authenticated', 'service_role', 'postgres')
    or rolcanlogin
 order by rolname;

\echo '== B. Appartenances d authenticator (attendu : web_anon et service_role, rien d autre) =='
select g.rolname as peut_devenir, g.rolsuper as superuser
  from pg_auth_members m
  join pg_roles g on g.oid = m.roleid
  join pg_roles u on u.oid = m.member
 where u.rolname = 'authenticator'
 order by 1;

\echo '== C. Schema public (attendu apres : web_anon usage=f, service_role usage=t) =='
select r.rolname,
       has_schema_privilege(r.oid, 'public', 'USAGE')  as usage,
       has_schema_privilege(r.oid, 'public', 'CREATE') as create
  from pg_roles r
 where r.rolname in ('web_anon', 'service_role', 'authenticator', 'anon', 'authenticated')
 order by 1;

\echo '== D. INSTANTANE : grants explicites a PUBLIC sur les tables (avant : a conserver ; apres : attendu vide) =='
select format('grant %s on table %I.%I to public;',
              string_agg(a.privilege_type, ', ' order by a.privilege_type), n.nspname, c.relname) as a_rejouer_pour_restaurer
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
 where n.nspname = 'public' and a.grantee = 0 and c.relkind in ('r', 'v', 'm', 'p', 'f')
 group by n.nspname, c.relname
 order by c.relname;

\echo '== E. FAILLE : tables lisibles ou modifiables par web_anon (attendu apres : aucune ligne) =='
select c.relname,
       has_table_privilege('web_anon', c.oid, 'SELECT') as sel,
       has_table_privilege('web_anon', c.oid, 'INSERT') as ins,
       has_table_privilege('web_anon', c.oid, 'UPDATE') as upd,
       has_table_privilege('web_anon', c.oid, 'DELETE') as del
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
   and exists (select 1 from pg_roles where rolname = 'web_anon')
   and has_schema_privilege('web_anon', 'public', 'USAGE')
   and (has_table_privilege('web_anon', c.oid, 'SELECT')
     or has_table_privilege('web_anon', c.oid, 'INSERT')
     or has_table_privilege('web_anon', c.oid, 'UPDATE')
     or has_table_privilege('web_anon', c.oid, 'DELETE'))
 order by 1;

\echo '== F. CASSE : tables SANS DML pour service_role (attendu apres : aucune ligne) =='
select c.relname, pg_get_userbyid(c.relowner) as proprietaire
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
   and exists (select 1 from pg_roles where rolname = 'service_role')
   and not (has_table_privilege('service_role', c.oid, 'SELECT')
        and has_table_privilege('service_role', c.oid, 'INSERT')
        and has_table_privilege('service_role', c.oid, 'UPDATE')
        and has_table_privilege('service_role', c.oid, 'DELETE'))
 order by 1;

\echo '== G. Fonctions de public : EXECUTE (attendu apres : web_anon=f partout, service_role=t partout) =='
select p.oid::regprocedure as fonction, p.prosecdef as security_definer,
       pg_get_userbyid(p.proowner) as proprietaire,
       case when exists (select 1 from pg_roles where rolname = 'web_anon')
            then has_function_privilege('web_anon', p.oid, 'EXECUTE') end as web_anon,
       case when exists (select 1 from pg_roles where rolname = 'service_role')
            then has_function_privilege('service_role', p.oid, 'EXECUTE') end as service_role
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
 order by p.prosecdef desc, p.proname;

\echo '== H. Tables avec RLS active (info : service_role est BYPASSRLS, sans effet sur l app) =='
select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
 order by 1;

\echo '== I. Privileges par defaut (attendu apres : service_role DML/sequences/execute dans public) =='
select pg_get_userbyid(d.defaclrole) as pour_les_objets_de,
       coalesce(n.nspname, '(tous schemas)') as schema,
       case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences'
                            when 'f' then 'fonctions' else d.defaclobjtype::text end as objets,
       d.defaclacl
  from pg_default_acl d
  left join pg_namespace n on n.oid = d.defaclnamespace
 order by 1, 2, 3;

\echo '== J. Tables hors de public (info : a exposer seulement si PGRST_DB_SCHEMAS les liste) =='
select n.nspname, count(*) as tables
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r', 'p')
   and n.nspname not in ('pg_catalog', 'information_schema', 'public')
   and n.nspname not like 'pg_toast%'
 group by 1 order by 1;

\echo '== Z. VERDICT (une ligne par controle ; attendu apres migration : tout a OK) =='
select controle, case when ok then 'OK' else 'KO' end as verdict
from (
  select 'roles presents' as controle,
         (select count(*) from pg_roles where rolname in ('authenticator','web_anon','service_role')) = 3 as ok
  union all
  select 'aucun des trois n est superuser',
         not exists (select 1 from pg_roles where rolname in ('authenticator','web_anon','service_role') and rolsuper)
  union all
  select 'authenticator NOINHERIT',
         coalesce((select not rolinherit from pg_roles where rolname = 'authenticator'), false)
  union all
  select 'authenticator ne peut devenir que web_anon / service_role',
         exists (select 1 from pg_roles where rolname = 'authenticator')
         and not exists (
           select 1 from pg_auth_members m
             join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
            where u.rolname = 'authenticator' and g.rolname not in ('web_anon','service_role'))
  union all
  select 'web_anon sans USAGE sur public',
         exists (select 1 from pg_roles where rolname = 'web_anon')
         and not has_schema_privilege('web_anon', 'public', 'USAGE')
  union all
  select 'aucun grant a PUBLIC sur les tables de public',
         not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      cross join lateral aclexplode(c.relacl) a
                      where n.nspname = 'public' and a.grantee = 0)
  union all
  select 'service_role a le DML sur toutes les tables de public',
         exists (select 1 from pg_roles where rolname = 'service_role')
         and not exists (
           select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r','p')
              and not (has_table_privilege('service_role', c.oid, 'SELECT')
                   and has_table_privilege('service_role', c.oid, 'INSERT')
                   and has_table_privilege('service_role', c.oid, 'UPDATE')
                   and has_table_privilege('service_role', c.oid, 'DELETE')))
  union all
  select 'service_role peut executer toutes les fonctions de public',
         exists (select 1 from pg_roles where rolname = 'service_role')
         and not exists (
           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and not has_function_privilege('service_role', p.oid, 'EXECUTE'))
  union all
  select 'service_role BYPASSRLS',
         coalesce((select rolbypassrls from pg_roles where rolname = 'service_role'), false)
  union all
  select 'service_role n est membre d aucun role (jamais studiio)',
         not exists (select 1 from pg_auth_members m join pg_roles u on u.oid = m.member
                      where u.rolname = 'service_role')
  union all
  select 'anon / authenticated herites : ni login, ni superuser, ni bypassrls, ni membres',
         not exists (select 1 from pg_roles where rolname in ('anon','authenticated')
                      and (rolcanlogin or rolsuper or rolbypassrls or rolcreaterole or rolcreatedb))
         and not exists (select 1 from pg_auth_members m join pg_roles u on u.oid = m.member
                          where u.rolname in ('anon','authenticated'))
  union all
  select 'toute fonction SECURITY DEFINER de public a un search_path fige',
         not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.prosecdef
                        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                                         where c like 'search_path=%'))
  union all
  select 'aucune fonction SECURITY DEFINER de public executable par PUBLIC',
         not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where n.nspname = 'public' and p.prosecdef and a.grantee = 0
                        and a.privilege_type = 'EXECUTE')
) v;

rollback;
