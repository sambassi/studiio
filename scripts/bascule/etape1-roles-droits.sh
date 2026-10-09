cat > /tmp/prod-etape1.sh <<'SCRIPT'
#!/usr/bin/env bash
# #533 ETAPE 1 PRODUCTION : roles + droits seulement.
# PostgREST, cles, variables : INCHANGES. Aucun
# redemarrage. Rollback automatique si un controle
# critique echoue.
set -uo pipefail
umask 077
D0=/root/backups/prod-533-20261009T140434Z
EMPREINTE_V3=42b0cfe09ca64a2b
stop() { echo "STOP: $*"; exit 1; }
DB=$(docker ps --filter name=qhhaglete0jnw1ixrjer3ho8 \
  --format '{{.Names}}' | head -1)
APP=$(docker ps --filter name=l142u3oa8w38xz1zcu6t5lnl \
  --format '{{.Names}}' | head -1)
PG=$(docker ps --format '{{.Names}} {{.Image}}' \
  | awk '$1 ~ /studiio-postgrest/ && $2 ~ /postgrest/' \
  | awk '{print $1}' | head -1)
[ -n "$DB" ] && [ -n "$APP" ] && [ -n "$PG" ] \
  || stop "conteneurs introuvables"
[ -s "$D0/base.dump" ] || stop "sauvegarde etape 0 absente"
W=/root/backups/prod-533-etape1-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$W"
echo "TRAVAIL=$W"
sqlw() {
  docker exec -i "$DB" psql -U studiio -d studiio \
    -At -F ' ' -v ON_ERROR_STOP=1 "$@"
}
ko() { MOTIFS="$MOTIFS $1"; echo "KO $1"; }
controle() {
  ANON=$1; ROLE=$2; MOTIFS=""
# 1. Depuis l'application, par SON chemin (proxy /rest/v1)
R=$(docker exec -e ANON="$ANON" "$APP" node -e '
const k = process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const u = (process.env.SUPABASE_URL || "")
  .replace(/\/$/, "") + "/rest/v1";
let role = "illisible";
try {
  role = JSON.parse(Buffer.from(k.split(".")[1],
    "base64url")).role;
} catch {}
const T = ["users","scheduled_posts","videos",
  "user_avatars","avatar_generations",
  "social_accounts","app_settings",
  "credit_transactions","autopilot_config",
  "autopilot_jumeau_attente","plans","credit_packs",
  "subscriptions","user_settings",
  "user_voices","rendus","render_jobs",
  "publishing_history","zernio_accounts"];
const H = { apikey: k, Authorization: "Bearer " + k };
(async () => {
  console.log("ROLE_CLE " + role);
  const a = await fetch(u + "/users?select=id&limit=0");
  console.log("ANONYME " + a.status);
  for (const t of T) {
    const r = await fetch(u + "/" + t
      + "?select=*&limit=0", { headers: H });
    console.log("TABLE " + t + " " + r.status);
  }
})().catch((e) => console.log("ERREUR " + e.message));
' 2>&1)
printf '%s\n' "$R"
RC=$(printf '%s\n' "$R" | sed -n 's/^ROLE_CLE //p')
[ "$RC" = "$ROLE" ] || ko "role_cle=$RC(attendu_$ROLE)"
A=$(printf '%s\n' "$R" | sed -n 's/^ANONYME //p')
[ "$A" = "$ANON" ] || ko "anonyme=$A(attendu_$ANON)"
printf '%s\n' "$R" | grep -q '^ERREUR' \
  && ko "erreur_reseau"
while read -r _ t c; do
  case "$c" in
    200) ;;
    404) echo "ATTENTION table absente : $t" ;;
    *) ko "table_${t}=$c" ;;
  esac
done < <(printf '%s\n' "$R" | grep '^TABLE ')
# 2. EXECUTE des RPC serveur pour le role de la cle
sql() {
  docker exec -i "$DB" psql -U studiio -d studiio \
    -At -v ON_ERROR_STOP=1 "$@"
}
F=$(sql -v r="$RC" <<'SQL'
select p.proname
from pg_proc p join pg_namespace n
  on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('debiter_credits',
   'debiter_credits_operation','confirmer_rendu',
   'confirmer_rendu_sans_debit','clore_rendu',
   'lut_assets_ajouter','crediter_credits_stripe',
   'stripe_event_claim','stripe_event_complete',
   'stripe_event_fail')
  and exists (select 1 from pg_roles
              where rolname = :'r')
  and not has_function_privilege(:'r', p.oid,
                                 'execute');
SQL
) || ko "rpc_illisible"
[ -z "$F" ] || ko "rpc_sans_execute:$(echo $F | tr ' ' ,)"
# 3. Avatar v3 intact (empreinte, jamais l'identifiant)
V=$(sql <<'SQL'
select a.version || ' ' || a.status || ' '
  || coalesce(a.provider_avatar_id, '')
from user_avatars a join users u on u.id = a.user_id
where u.email = 'contact.artboost@gmail.com'
  and a.deleted_at is null
order by a.created_at limit 1;
SQL
) || ko "v3_illisible"
VV=${V%% *}; RESTE=${V#* }; VS=${RESTE%% *}
VP=${RESTE#* }
EMP=$(printf '%s' "$VP" | sha256sum | cut -c1-16)
echo "AVATAR_V3 version=$VV statut=$VS empreinte=$EMP"
[ "$VV" = 3 ] && [ "$VS" = completed ] \
  && [ "$EMP" = "$EMPREINTE_V3" ] || ko "avatar_v3"
  if [ -z "$MOTIFS" ]; then echo "VERDICT=CONTINUER"
    return 0
  fi
  echo "VERDICT=ROLLBACK$MOTIFS"
  return 1
}
comptes() {
  sqlw <<'SQL'
select 'users', count(*) from users;
select 'credits', coalesce(sum(credits),0) from users;
select 'credit_transactions', count(*)
 from credit_transactions;
select 'scheduled_posts', count(*) from scheduled_posts;
select 'videos', count(*) from videos;
select 'user_avatars', count(*) from user_avatars;
select 'avatar_generations', count(*)
 from avatar_generations;
select 'social_accounts', count(*) from social_accounts;
select 'autopilot_config', count(*) from autopilot_config;
SQL
}
cat > "$W/mig.sql" <<'FIN_SQL'
begin;
do $$
begin
  if not (select rolsuper from pg_roles
          where rolname = current_user) then
    raise exception 'a jouer en superuser, pas en %',
      current_user;
  end if;
end $$;
do $$
begin
  if not exists (select 1 from pg_roles
                 where rolname = 'web_anon') then
    create role web_anon nologin;
  end if;
  if not exists (select 1 from pg_roles
                 where rolname = 'service_role') then
    create role service_role nologin;
  end if;
  if not exists (select 1 from pg_roles
                 where rolname = 'authenticator') then
    create role authenticator nologin noinherit;
  end if;
end $$;
alter role web_anon nologin nosuperuser nocreatedb
  nocreaterole noreplication nobypassrls;
alter role service_role nologin nosuperuser nocreatedb
  nocreaterole noreplication bypassrls;
alter role authenticator noinherit nosuperuser
  nocreatedb nocreaterole noreplication nobypassrls;
grant web_anon to authenticator;
grant service_role to authenticator;
do $$
declare r record;
begin
  for r in
    select g.rolname
      from pg_auth_members m
      join pg_roles g on g.oid = m.roleid
      join pg_roles u on u.oid = m.member
     where u.rolname = 'authenticator'
       and (g.rolsuper or g.rolname not in
            ('web_anon', 'service_role'))
  loop
    execute format('revoke %I from authenticator',
                   r.rolname);
  end loop;
end $$;
do $$
declare r text; g record;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles
               where rolname = r) then
      execute format('alter role %I nologin nosuperuser'
        || ' nocreatedb nocreaterole noreplication'
        || ' nobypassrls', r);
      for g in
        select gr.rolname
          from pg_auth_members m
          join pg_roles gr on gr.oid = m.roleid
          join pg_roles u on u.oid = m.member
         where u.rolname = r
      loop
        execute format('revoke %I from %I',
                       g.rolname, r);
      end loop;
    end if;
  end loop;
end $$;
revoke create on schema public from public;
revoke usage on schema public from public;
grant usage on schema public to service_role;
revoke all on all tables in schema public from public;
revoke all on all sequences in schema public
  from public;
revoke all on all routines in schema public
  from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles
               where rolname = r) then
      execute format('revoke all on all tables in'
        || ' schema public from %I', r);
      execute format('revoke all on all sequences in'
        || ' schema public from %I', r);
      execute format('revoke all on all routines in'
        || ' schema public from %I', r);
      execute format('revoke all on schema public'
        || ' from %I', r);
    end if;
  end loop;
end $$;
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and not exists (
         select 1
           from unnest(coalesce(p.proconfig, '{}')) c
          where c like 'search_path=%')
  loop
    execute format('alter function %s set'
      || ' search_path = pg_catalog, public', f.sig);
  end loop;
end $$;
grant select, insert, update, delete
  on all tables in schema public to service_role;
grant usage, select
  on all sequences in schema public to service_role;
grant execute
  on all routines in schema public to service_role;
alter default privileges
  revoke execute on routines from public;
alter default privileges in schema public
  grant select, insert, update, delete
  on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
alter default privileges in schema public
  grant execute on routines to service_role;
commit;
FIN_SQL
cat > "$W/rb.sql" <<'FIN_SQL'
begin;
grant usage on schema public to public;
alter default privileges
  grant execute on routines to public;
do $$
begin
  if exists (select 1 from pg_roles
             where rolname = 'service_role') then
    alter default privileges in schema public
      revoke select, insert, update, delete
      on tables from service_role;
    alter default privileges in schema public
      revoke usage, select on sequences
      from service_role;
    alter default privileges in schema public
      revoke execute on routines from service_role;
  end if;
end $$;
do $$
declare r text;
begin
  foreach r in array array['authenticator',
                           'service_role', 'web_anon'] loop
    if exists (select 1 from pg_roles
               where rolname = r) then
      execute format('drop owned by %I', r);
      execute format('drop role %I', r);
    end if;
  end loop;
end $$;
commit;
FIN_SQL
cat > "$W/snap.sql" <<'FIN_SQL'
select format('grant %s on %s %I.%I to %s;',
  string_agg(a.privilege_type, ', '),
  case c.relkind when 'S' then 'sequence'
    else 'table' end,
  n.nspname, c.relname,
  case when a.grantee = 0 then 'public'
    else quote_ident(pg_get_userbyid(a.grantee)) end)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(c.relacl) a
where n.nspname = 'public'
  and c.relkind in ('r','v','m','p','f','S')
  and (a.grantee = 0 or pg_get_userbyid(a.grantee)
       in ('anon', 'authenticated'))
group by n.nspname, c.relname, c.relkind, a.grantee;
select format('grant execute on function %s to %s;',
  p.oid::regprocedure,
  case when a.grantee = 0 then 'public'
    else quote_ident(pg_get_userbyid(a.grantee)) end)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl,
  acldefault('f', p.proowner))) a
where n.nspname = 'public'
  and a.privilege_type = 'EXECUTE'
  and (a.grantee = 0 or pg_get_userbyid(a.grantee)
       in ('anon', 'authenticated'));
select format('grant %s on schema public to %s;',
  a.privilege_type,
  case when a.grantee = 0 then 'public'
    else quote_ident(pg_get_userbyid(a.grantee)) end)
from pg_namespace n
cross join lateral aclexplode(n.nspacl) a
where n.nspname = 'public'
  and (a.grantee = 0 or pg_get_userbyid(a.grantee)
       in ('anon', 'authenticated'));
select format('alter role %I %s %s %s %s %s;', rolname,
  case when rolcanlogin then 'login' else 'nologin' end,
  case when rolsuper then 'superuser'
    else 'nosuperuser' end,
  case when rolcreatedb then 'createdb'
    else 'nocreatedb' end,
  case when rolcreaterole then 'createrole'
    else 'nocreaterole' end,
  case when rolbypassrls then 'bypassrls'
    else 'nobypassrls' end)
from pg_roles where rolname in ('anon', 'authenticated');
select format('grant %I to %I;', g.rolname, u.rolname)
from pg_auth_members m
join pg_roles g on g.oid = m.roleid
join pg_roles u on u.oid = m.member
where u.rolname in ('anon', 'authenticated');
FIN_SQL
cat > "$W/verdict.sql" <<'FIN_SQL'
select 'Z roles_presents', (select count(*) from pg_roles
  where rolname in ('authenticator','web_anon',
  'service_role')) = 3;
select 'Z aucun_superuser', not exists (select 1
  from pg_roles where rolsuper and rolname in
  ('authenticator','web_anon','service_role'));
select 'Z authenticator_noinherit', coalesce((select
  not rolinherit from pg_roles
  where rolname = 'authenticator'), false);
select 'Z authenticator_deux_roles', not exists (
  select 1 from pg_auth_members m
  join pg_roles g on g.oid = m.roleid
  join pg_roles u on u.oid = m.member
  where u.rolname = 'authenticator'
    and g.rolname not in ('web_anon','service_role'));
select 'Z web_anon_sans_usage', not has_schema_privilege(
  'web_anon', 'public', 'USAGE');
select 'Z aucun_grant_public_tables', not exists (
  select 1 from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
  where n.nspname = 'public' and a.grantee = 0);
select 'Z service_role_dml', not exists (
  select 1 from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p')
  and not (has_table_privilege('service_role', c.oid,
    'SELECT') and has_table_privilege('service_role',
    c.oid, 'INSERT') and has_table_privilege(
    'service_role', c.oid, 'UPDATE')
    and has_table_privilege('service_role', c.oid,
    'DELETE')));
select 'Z service_role_execute', not exists (
  select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and not
  has_function_privilege('service_role', p.oid,
  'EXECUTE'));
select 'Z service_role_bypassrls', (select rolbypassrls
  from pg_roles where rolname = 'service_role');
select 'Z service_role_membre_de_rien', not exists (
  select 1 from pg_auth_members m
  join pg_roles u on u.oid = m.member
  where u.rolname = 'service_role');
select 'Z herites_neutralises', not exists (
  select 1 from pg_roles
  where rolname in ('anon','authenticated')
  and (rolcanlogin or rolsuper or rolbypassrls))
  and not exists (select 1 from pg_auth_members m
  join pg_roles u on u.oid = m.member
  where u.rolname in ('anon','authenticated'));
select 'Z secdef_search_path', not exists (
  select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
  and not exists (select 1 from unnest(coalesce(
  p.proconfig, '{}')) c where c like 'search_path=%'));
select 'Z secdef_ferme_a_public', not exists (
  select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl,
  acldefault('f', p.proowner))) a
  where n.nspname = 'public' and p.prosecdef
  and a.grantee = 0);
FIN_SQL
echo "=== A. GARDES AVANT ==="
E=$(docker inspect "$PG" \
  --format '{{range .Config.Env}}{{println .}}{{end}}')
LOGIN=$(printf '%s\n' "$E" \
  | sed -nE 's#^PGRST_DB_URI=[a-z]+://([^:@/]+).*#\1#p')
ANONR=$(printf '%s\n' "$E" \
  | sed -n 's/^PGRST_DB_ANON_ROLE=//p')
echo "PGRST_LOGIN=$LOGIN PGRST_ANON_ROLE=$ANONR"
[ "$LOGIN" = studiio ] && [ "$ANONR" = studiio ] \
  || stop "PostgREST n'est plus dans l'etat attendu"
N=$(sqlw -c "select count(*) from pg_roles where rolname
  in ('authenticator','web_anon','service_role')")
[ "$N" = 0 ] || stop "roles cible deja presents ($N)"
controle 200 studiio > "$W/controle-avant.txt" \
  || { cat "$W/controle-avant.txt"; stop "avant KO"; }
grep -E '^(AVATAR|VERDICT)' "$W/controle-avant.txt"
comptes > "$W/comptes-avant.txt" || stop "comptes"
sqlw < "$W/snap.sql" \
  > "$W/restaurer-droits.sql" || stop "instantane"
echo "INSTANTANE_RESTAURATION=$(wc -l \
  < "$W/restaurer-droits.sql") lignes"
echo "=== B. MIGRATION (une transaction) ==="
if ! sqlw -q < "$W/mig.sql" \
  > "$W/mig.log" 2>&1; then
  cat "$W/mig.log"
  stop "migration refusee : transaction annulee"
fi
echo "MIGRATION_APPLIQUEE=oui"
echo "=== C. CONTROLES APRES ==="
ECHEC=""
# Code retour de psql verifie AVANT tout affichage :
# une erreur SQL est un echec, jamais un passage.
if ! sqlw < "$W/verdict.sql" > "$W/verdict.txt" 2>&1
then ECHEC="verdict_Z_erreur_sql"; fi
cat "$W/verdict.txt"
[ "$(grep -c '^Z .* t$' "$W/verdict.txt")" = 13 ] \
  || ECHEC="$ECHEC verdict_Z_incomplet"
controle 200 studiio > "$W/controle-apres.txt" \
  || ECHEC="$ECHEC controle"
grep -E '^(KO|AVATAR|VERDICT)' "$W/controle-apres.txt"
comptes > "$W/comptes-apres.txt"
if diff "$W/comptes-avant.txt" "$W/comptes-apres.txt" \
  > /dev/null; then
  echo "COMPTES_INCHANGES=oui"
else
  echo "COMPTES_INCHANGES=non (activite du site ?)"
  diff "$W/comptes-avant.txt" "$W/comptes-apres.txt"
fi
if [ -z "$ECHEC" ]; then
  echo "STAGE1_APPLIED=oui"
  echo "VERDICT_FINAL=CONTINUER"
  exit 0
fi
echo "=== D. ROLLBACK AUTOMATIQUE ($ECHEC) ==="
sqlw -q < "$W/rb.sql" \
  && sqlw -q < "$W/restaurer-droits.sql" \
  && echo "ROLLBACK_FAIT=oui" || echo "ROLLBACK_FAIT=NON"
controle 200 studiio | grep -E '^(KO|AVATAR|VERDICT)'
echo "STAGE1_APPLIED=non"
echo "VERDICT_FINAL=ROLLBACK"
exit 1
SCRIPT
bash -n /tmp/prod-etape1.sh && echo SYNTAXE_OK
bash /tmp/prod-etape1.sh
