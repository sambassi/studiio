cat > /tmp/etape3-cle.sh <<'SCRIPT'
#!/usr/bin/env bash
# #533 ETAPE 3 : cle backend role=service_role.
# Ajoute SUPABASE_SERVICE_KEY (prioritaire dans le code)
# dans Coolify ; l'ancienne SUPABASE_SERVICE_ROLE_KEY
# reste intacte. Rollback = supprimer la nouvelle
# variable puis redemarrer. Aucun secret affiche.
set -uo pipefail
umask 077
ATTENDU_SHA=1ca7d8c570abade7
S=$(grep -v '^ATTENDU_SHA=' "$0" | sha256sum | cut -c1-16)
[ "$S" = "$ATTENDU_SHA" ] || {
  echo "STOP: script altere au collage ($S)"; exit 1; }
echo "INTEGRITE_SCRIPT=ok"
EMP_V3=42b0cfe09ca64a2b
APP_UUID=l142u3oa8w38xz1zcu6t5lnl
API=${COOLIFY_API:-http://127.0.0.1:8000/api/v1}
PG=studiio-postgrest
W=/root/backups/prod-533-etape3-$(date -u +%Y%m%dT%H%M%SZ)
T=$(mktemp -d /root/.pgrst-e3.XXXXXX)
trap 'rm -rf "$T"' EXIT
stop() { echo "STOP: $*"; exit 1; }
mkdir -p "$W"
DB=$(docker ps --filter name=qhhaglete0jnw1ixrjer3ho8 \
  --format '{{.Names}}' | head -1)
app_ctr() {
  docker ps --filter "name=$APP_UUID" \
    --format '{{.Names}}' | head -1
}
APP=$(app_ctr)
[ -n "$DB" ] && [ -n "$APP" ] || stop "db/app introuvables"
sqlw() {
  docker exec -i "$DB" psql -U studiio -d studiio \
    -At -F ' ' -v ON_ERROR_STOP=1 "$@"
}
KO=""
ko() { KO="$KO $1"; echo "KO $1"; }
api() { # methode chemin [fichier-corps]
  local c
  if [ -n "${3:-}" ]; then
    c=$(curl -s -o "$T/rep" -w '%{http_code}' -X "$1" \
      -H @"$T/h" -H 'Content-Type: application/json' \
      --data-binary @"$3" "$API$2")
  else
    c=$(curl -s -o "$T/rep" -w '%{http_code}' -X "$1" \
      -H @"$T/h" "$API$2")
  fi
  echo "$c"
}
controle() {
local ATT_CLE=$1 Z NZ E L AR S i R RC AN APP
local NT RPC_RESULT V VV RE VS VP EMP
KO=""
APP=$(app_ctr)
echo "=== 2. CONTROLES Z (les 13) ==="
cat > /tmp/valide-z.sql <<'SQL'
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
SQL
if ! Z=$(sqlw < /tmp/valide-z.sql 2>&1); then
  ko "z_erreur_sql"
fi
printf '%s\n' "$Z"
NZ=$(printf '%s\n' "$Z" | grep -c '^Z .* t$')
echo "Z_EXECUTES_ET_OK=$NZ/13"
[ "$NZ" = 13 ] || ko "z_${NZ}_sur_13"
echo "=== POSTGREST (login studiio, anon web_anon) ==="
E=$(docker inspect "$PG" \
  --format '{{range .Config.Env}}{{println .}}{{end}}')
L=$(printf '%s\n' "$E" \
  | sed -nE 's#^PGRST_DB_URI=[a-z]+://([^:@/]+).*#\1#p')
AR=$(printf '%s\n' "$E" \
  | sed -n 's/^PGRST_DB_ANON_ROLE=//p')
echo "PGRST_LOGIN=$L"
echo "PGRST_ANON_ROLE=$AR"
[ "$L" = studiio ] || ko "login_$L"
[ "$AR" = web_anon ] || ko "anon_$AR"
echo "=== 4. BACKEND PAR LE CHEMIN DE L'APP ==="
# PostgREST vient de redemarrer : jusqu'a 60 s pour
# repondre, sans jamais conclure trop tot.
for i in $(seq 1 12); do
  S=$(docker exec "$APP" node -e '
const k = process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const u = (process.env.SUPABASE_URL || "")
  .replace(/\/$/, "") + "/rest/v1/users?limit=0";
fetch(u, { headers: { apikey: k,
  Authorization: "Bearer " + k } })
  .then((r) => console.log(r.status))
  .catch(() => console.log(0));' 2>/dev/null)
  [ "$S" = 200 ] && break
  sleep 5
done
echo "POSTGREST_PRET=$S"
R=$(docker exec "$APP" node -e '
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
' 2>&1) || ko "sonde_node"
RC=$(printf '%s\n' "$R" | sed -n 's/^ROLE_CLE //p')
AN=$(printf '%s\n' "$R" | sed -n 's/^ANONYME //p')
echo "SERVICE_KEY_ROLE=$RC"
echo "ANONYME=$AN (attendu 401)"
[ "$RC" = "$ATT_CLE" ] || ko "cle_$RC(attendu_$ATT_CLE)"
[ "$AN" = 401 ] || ko "anonyme_$AN"
printf '%s\n' "$R" | grep -q '^ERREUR' \
  && ko "erreur_reseau"
NT=$(printf '%s\n' "$R" | grep -c '^TABLE .* 200$')
echo "TABLES_200=$NT/19"
[ "$NT" = 19 ] || { ko "tables_${NT}_sur_19"
  printf '%s\n' "$R" | grep '^TABLE' | grep -v ' 200$'; }
echo "=== 5. RPC SERVEUR (10) ==="
if ! RPC_RESULT=$(sqlw <<'SQL' 2>&1
select r, count(*) filter (where
  has_function_privilege(r, p.oid, 'execute')),
  count(*)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace,
unnest(array['studiio','service_role']) r
where n.nspname = 'public'
  and p.proname in ('debiter_credits',
   'debiter_credits_operation','confirmer_rendu',
   'confirmer_rendu_sans_debit','clore_rendu',
   'lut_assets_ajouter','crediter_credits_stripe',
   'stripe_event_claim','stripe_event_complete',
   'stripe_event_fail')
group by r order by r;
SQL
); then ko "rpc_erreur_sql"; fi
printf '%s\n' "$RPC_RESULT" | sed 's/^/RPC /'
printf '%s\n' "$RPC_RESULT" | while read -r r x t; do
  [ "$x" = "$t" ] && [ "${t:-0}" -ge 10 ] || echo NOK
done | grep -q NOK && ko "rpc_incomplet"
[ "$(printf '%s\n' "$RPC_RESULT" | grep -c .)" = 2 ] \
  || ko "rpc_illisible"
echo "=== 6. JUMEAU V3 ==="
if ! V=$(sqlw <<'SQL' 2>&1
select a.version || ' ' || a.status || ' '
  || coalesce(a.provider_avatar_id, '')
from user_avatars a join users u on u.id = a.user_id
where u.email = 'contact.artboost@gmail.com'
  and a.deleted_at is null
order by a.created_at limit 1;
SQL
); then ko "v3_erreur_sql"; V=""; fi
VV=${V%% *}; RE=${V#* }; VS=${RE%% *}; VP=${RE#* }
EMP=$(printf '%s' "$VP" | sha256sum | cut -c1-16)
echo "V3 version=$VV statut=$VS empreinte=$EMP"
[ "$VV" = 3 ] && [ "$VS" = completed ] \
  && [ "$EMP" = "$EMP_V3" ] || ko "v3_change"
[ -z "$KO" ]
}
pret() {
  local i s a
  for i in $(seq 1 30); do
    a=$(app_ctr)
    s=$(docker exec "$a" node -e '
const k = process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const u = (process.env.SUPABASE_URL || "")
  .replace(/\/$/, "") + "/rest/v1/users?limit=0";
fetch(u, { headers: { apikey: k,
  Authorization: "Bearer " + k } })
  .then((r) => console.log(r.status))
  .catch(() => console.log(0));' 2>/dev/null)
    if [ "$s" = 200 ]; then
      echo "APP_PRETE_APRES=$((i*5))s"; return 0
    fi
    sleep 5
  done
  echo "APP_PRETE=non (dernier code $s)"; return 1
}
redemarrer() { # attend un NOUVEAU conteneur app
  local avant c i
  avant=$(docker inspect "$(app_ctr)" \
    --format '{{.Id}}{{.State.StartedAt}}' 2>/dev/null)
  c=$(api POST "/applications/$APP_UUID/restart")
  echo "REDEMARRAGE_DEMANDE=$c"
  case "$c" in 2??) ;; *) return 1 ;; esac
  for i in $(seq 1 60); do
    sleep 5
    c=$(docker inspect "$(app_ctr)" \
      --format '{{.Id}}{{.State.StartedAt}}' 2>/dev/null)
    [ -n "$c" ] && [ "$c" != "$avant" ] && break
  done
  if [ "$c" = "$avant" ]; then
    echo "REDEMARRE=non"; return 1
  fi
  echo "REDEMARRE=oui"
  pret
}
echo "=== A. GARDES ==="
E=$(docker inspect "$PG" \
  --format '{{range .Config.Env}}{{println .}}{{end}}')
AR=$(printf '%s\n' "$E" \
  | sed -n 's/^PGRST_DB_ANON_ROLE=//p')
[ "$AR" = web_anon ] || stop "anon=$AR (etape 2 absente)"
printf '%s\n' "$E" \
  | grep -q '^PGRST_JWT_SECRET_IS_BASE64=true' \
  && stop "secret JWT en base64 : non prevu"
docker exec "$APP" sh -c \
  'test -z "${SUPABASE_SERVICE_KEY:-}"' \
  || stop "SUPABASE_SERVICE_KEY deja presente"
docker exec "$APP" sh -c \
  'test -n "${SUPABASE_SERVICE_ROLE_KEY:-}"' \
  || stop "SUPABASE_SERVICE_ROLE_KEY absente"
P=$(sqlw <<'SQL'
select rolcanlogin, rolsuper, rolbypassrls,
  (select count(*) from pg_auth_members m
   where m.member = r.oid)
from pg_roles r where rolname = 'service_role';
SQL
) || stop "lecture service_role"
echo "SERVICE_ROLE login|super|bypassrls|membre_de=$P"
[ "$P" = "f f t 0" ] || stop "service_role inattendu"
controle studiio > "$T/avant.txt" \
  || { cat "$T/avant.txt"; stop "controle avant KO"; }
grep -E '^(V3|TABLES_200|SERVICE_KEY_ROLE)' "$T/avant.txt"
echo "=== B. NOUVELLE CLE (jamais affichee) ==="
printf '%s\n' "$E" | sed -n 's/^PGRST_JWT_SECRET=//p' \
  | docker exec -i "$APP" node -e '
const c = require("crypto");
const s = require("fs").readFileSync(0, "utf8")
  .replace(/\n$/, "");
const o = (process.env.SUPABASE_SERVICE_ROLE_KEY || "")
  .split(".")[1];
const p = o ? JSON.parse(Buffer.from(o, "base64url")) : {};
const cl = { ...p, role: "service_role",
  iat: Math.floor(Date.now() / 1000) };
const b = (x) => Buffer.from(JSON.stringify(x))
  .toString("base64url");
const h = b({ alg: "HS256", typ: "JWT" }), q = b(cl);
process.stdout.write(h + "." + q + "." + c
  .createHmac("sha256", s).update(h + "." + q)
  .digest("base64url"));' > "$T/cle" \
  || stop "generation impossible"
[ -s "$T/cle" ] || stop "cle vide"
echo "CLE_EMPREINTE=$(sha256sum < "$T/cle" | cut -c1-16)"
R=$(docker exec -i "$APP" node -e '
const t = require("fs").readFileSync(0, "utf8").trim();
const role = JSON.parse(Buffer.from(t.split(".")[1],
  "base64url")).role;
const u = (process.env.SUPABASE_URL || "")
  .replace(/\/$/, "") + "/rest/v1";
const H = { apikey: t, Authorization: "Bearer " + t };
(async () => {
  console.log("ROLE " + role);
  let ok = 0;
  for (const x of ["users","scheduled_posts",
    "user_avatars","avatar_generations",
    "credit_transactions","autopilot_config",
    "subscriptions","social_accounts"]) {
    const r = await fetch(u + "/" + x
      + "?select=*&limit=0", { headers: H });
    if (r.status === 200) ok++;
  }
  console.log("TABLES_OK " + ok + "/8");
})().catch((e) => console.log("ERREUR " + e.message));
' < "$T/cle" 2>&1)
printf '%s\n' "$R"
printf '%s\n' "$R" | grep -qx 'ROLE service_role' \
  || stop "nouvelle cle : role inattendu"
printf '%s\n' "$R" | grep -qx 'TABLES_OK 8/8' \
  || stop "nouvelle cle refusee par PostgREST"
echo "=== C. JETON API COOLIFY (saisie masquee) ==="
read -rsp "Jeton API Coolify (non affiche) : " TOK
echo
[ -n "$TOK" ] || stop "jeton vide"
printf 'Authorization: Bearer %s\n' "$TOK" > "$T/h"
unset TOK
c=$(api GET "/applications/$APP_UUID/envs")
[ "$c" = 200 ] || stop "API Coolify : $c"
N=$(python3 -c '
import json,sys
print(sum(1 for e in json.load(open(sys.argv[1]))
  if e.get("key") == "SUPABASE_SERVICE_KEY"))' "$T/rep")
[ "$N" = 0 ] \
  || stop "SUPABASE_SERVICE_KEY deja dans Coolify"
python3 -c '
import json,sys
v = open(sys.argv[1]).read().strip()
json.dump({"key": "SUPABASE_SERVICE_KEY", "value": v,
  "is_literal": True, "is_shown_once": True,
  "is_buildtime": False, "is_runtime": True,
  "is_preview": False},
  open(sys.argv[2], "w"))' "$T/cle" "$T/corps"
echo "=== D. BASCULE ==="
c=$(api POST "/applications/$APP_UUID/envs" "$T/corps")
rm -f "$T/corps"
case "$c" in 2??) ;; *) stop "creation variable : $c";; esac
EU=$(python3 -c '
import json,sys
print(json.load(open(sys.argv[1])).get("uuid", ""))' \
  "$T/rep")
[ -n "$EU" ] || stop "uuid de variable absent"
echo "$EU" > "$W/env-uuid"
echo "VARIABLE_CREEE=SUPABASE_SERVICE_KEY ($EU)"
retour() {
  echo "=== R. ROLLBACK ($1) ==="
  c=$(api DELETE "/applications/$APP_UUID/envs/$EU")
  echo "VARIABLE_SUPPRIMEE=$c"
  redemarrer
  controle studiio \
    | grep -E '^(KO|SERVICE_KEY_ROLE|ANONYME|TABLES_200|V3)'
  echo "ETAPE3_APPLIQUEE=non"
  echo "VERDICT_FINAL=ROLLBACK"
  exit 1
}
redemarrer || retour "redemarrage"
APP=$(app_ctr)
docker exec "$APP" sh -c \
  'test -n "${SUPABASE_SERVICE_KEY:-}"' \
  || retour "variable absente du conteneur"
echo "=== E. CONTROLE ETAPE 3 ==="
controle service_role > "$T/apres.txt"
CR=$?
grep -vE '^(Z |RPC |TABLE )' "$T/apres.txt"
[ "$CR" = 0 ] || retour "controle"
echo "ETAPE3_APPLIQUEE=oui"
echo "ROLLBACK_POSSIBLE : supprimer la variable $EU"
echo "VERDICT_FINAL=VALIDE"
SCRIPT
bash -n /tmp/etape3-cle.sh && echo SYNTAXE_OK
bash /tmp/etape3-cle.sh
