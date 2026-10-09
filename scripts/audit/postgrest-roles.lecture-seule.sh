cat > /tmp/audit-pgrst.sh <<'SCRIPT'
#!/usr/bin/env bash
# AUDIT LECTURE SEULE PostgREST/PostgreSQL.
# Aucune ecriture. Aucun secret affiche.
set -uo pipefail
DB=$(docker ps --filter name=qhhaglete0jnw1ixrjer3ho8 \
  --format '{{.Names}}' | head -1)
APP=$(docker ps --filter name=l142u3oa8w38xz1zcu6t5lnl \
  --format '{{.Names}}' | head -1)
echo "DB_CONTENEUR_TROUVE=$([ -n "$DB" ] && echo oui)"
echo "APP_CONTENEUR_TROUVE=$([ -n "$APP" ] && echo oui)"
env_de() {
  docker inspect -f \
    '{{range .Config.Env}}{{println .}}{{end}}' "$1"
}
# 1. Conteneurs PostgREST / proxy : image, ports, regles
echo "--- CONTENEURS_POSTGREST ---"
PGRST=""
while read -r nom image; do
  case "$nom $image" in
    *postgrest*|*pgrst*) ;;
    *) continue ;;
  esac
  echo "CONTENEUR=$nom IMAGE=$image"
  docker ps --filter "name=^${nom}$" \
    --format 'PORTS={{.Ports}}'
  docker inspect -f \
    '{{range $k,$v := .Config.Labels}}{{$k}}={{$v}}
{{end}}' "$nom" | grep -i 'rule=' \
    | sed 's/^/TRAEFIK_/'
  case "$image" in
    *postgrest*) PGRST="$nom" ;;
  esac
done < <(docker ps --format '{{.Names}} {{.Image}}')
echo "POSTGREST_CONTENEUR=${PGRST:-introuvable}"
# 2. Configuration PostgREST (sans secret)
LOGIN=""; ANON=""
if [ -n "$PGRST" ]; then
  E=$(env_de "$PGRST")
  URI=$(printf '%s\n' "$E" | sed -n 's/^PGRST_DB_URI=//p')
  LOGIN=$(printf '%s' "$URI" \
    | sed -E 's#^[a-z]+://##; s#[:@].*##')
  ANON=$(printf '%s\n' "$E" \
    | sed -n 's/^PGRST_DB_ANON_ROLE=//p')
  for v in PGRST_DB_SCHEMAS PGRST_DB_SCHEMA \
    PGRST_JWT_ROLE_CLAIM_KEY PGRST_DB_PRE_REQUEST; do
    printf '%s\n' "$E" | grep "^$v=" || true
  done
  S=$(printf '%s\n' "$E" | grep -c '^PGRST_JWT_SECRET=.')
  P=non; [ "$S" -gt 0 ] && P=oui
  echo "PGRST_JWT_SECRET_PRESENT=$P"
fi
echo "POSTGREST_LOGIN_ROLE=${LOGIN:-inconnu}"
echo "POSTGREST_ANON_ROLE=${ANON:-inconnu}"
# 3. Role porte par le jeton serveur (claim seulement)
if [ -n "$APP" ]; then
  for k in SUPABASE_SERVICE_KEY \
    SUPABASE_SERVICE_ROLE_KEY; do
    J=$(docker exec "$APP" printenv "$k" 2>/dev/null)
    [ -n "$J" ] || continue
    R=$(printf '%s' "$J" | python3 -c '
import sys,json,base64
p=sys.stdin.read().split(".")[1]
p+="="*(-len(p)%4)
print(json.loads(base64.urlsafe_b64decode(p)).get("role"))
' 2>/dev/null)
    echo "JWT_ROLE_$k=${R:-illisible}"
  done
fi
# 4. Roles (lecture seule)
sql() {
  docker exec -i "$DB" psql -U studiio -d studiio \
    -At -F ' ' -v ON_ERROR_STOP=1 "$@"
}
echo "--- ROLES ---"
L=${LOGIN:-x}; A=${ANON:-x}
sql -v l="$L" -v a="$A" <<'SQL'
select 'ROLE', rolname,
 'super='||rolsuper, 'inherit='||rolinherit,
 'createrole='||rolcreaterole,
 'createdb='||rolcreatedb,
 'login='||rolcanlogin,
 'bypassrls='||rolbypassrls
from pg_roles
where rolname in ('studiio','anon','authenticated',
 'service_role','web_anon','authenticator',
 :'l', :'a')
order by rolname;
select 'MEMBRE', m.rolname, 'peut_devenir', r.rolname
from pg_auth_members x
join pg_roles m on m.oid = x.member
join pg_roles r on r.oid = x.roleid
where m.rolname in (:'l', :'a', 'authenticator');
SQL
# 5. Fonctions avatar : existence et EXECUTE
echo "--- FONCTIONS ---"
sql -v a="$A" <<'SQL'
select 'FONCTION', p.oid::regprocedure,
 'secdef='||p.prosecdef,
 'acl='||coalesce(p.proacl::text,'defaut(public)')
from pg_proc p join pg_namespace n
 on n.oid = p.pronamespace
where n.nspname = 'public'
 and p.proname in ('activer_version_avatar',
  'definir_avatar_par_defaut');
select 'FONCTIONS_AVATAR_PRESENTES', count(*)
from pg_proc where proname in
 ('activer_version_avatar','definir_avatar_par_defaut');
select 'DEFAULT_ACL', coalesce(r.rolname,'*'),
 d.defaclobjtype, d.defaclacl::text
from pg_default_acl d
left join pg_roles r on r.oid = d.defaclrole;
select 'ANON_LIT_USERS',
 has_table_privilege(:'a','public.users','select')
where exists (select 1 from pg_roles
 where rolname = :'a');
select 'ANON_EXECUTE_CREDITER',
 has_function_privilege(:'a', p.oid, 'execute')
from pg_proc p
where p.proname = 'crediter_credits_stripe'
 and exists (select 1 from pg_roles
  where rolname = :'a');
SQL
# 6. Sonde HTTP SANS jeton, GET seulement, code seul
echo "--- SONDES_SANS_JETON ---"
if [ -n "$PGRST" ]; then
  IP=$(docker inspect -f \
   '{{range .NetworkSettings.Networks}}{{.IPAddress}}
{{end}}' \
   "$PGRST" | grep . | head -1)
  C=$(curl -s -o /dev/null -m 10 -w '%{http_code}' \
    "http://$IP:3000/users?select=id&limit=1")
  echo "INTERNE_GET_USERS_SANS_JETON=$C"
fi
hotes() {
  local n
  docker ps --format '{{.Names}}' | while read -r n; do
    case "$n" in
      *postgrest*|*pgrst*) ;;
      *) continue ;;
    esac
    docker inspect -f \
      '{{range $k,$v := .Config.Labels}}{{$v}}
{{end}}' "$n" | grep -o 'Host(`[^`]*`)' \
      | sed 's/Host(`//; s/`)//'
  done | sort -u
}
for h in $(hotes); do
  C=$(curl -s -o /dev/null -m 10 -w '%{http_code}' \
    "https://$h/users?select=id&limit=1")
  echo "PUBLIC_GET_USERS_SANS_JETON $h=$C"
done
echo "AUDIT_TERMINE=oui"
SCRIPT
bash -n /tmp/audit-pgrst.sh && echo SYNTAXE_OK
bash /tmp/audit-pgrst.sh
