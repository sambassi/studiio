cat > /tmp/etape4.sh <<'SCRIPT'
#!/usr/bin/env bash
# #533 ETAPE 4 : PostgREST se connecte en authenticator
# (plus en superutilisateur studiio).
# 1. authenticator : LOGIN + mot de passe aleatoire,
#    pose en verificateur SCRAM (jamais en clair).
# 2. nouveau PostgREST lance A COTE de l'ancien, teste.
# 3. echange, rechargement nginx, controle complet.
# Rollback automatique a chaque etape. Aucun secret
# affiche. Le secours de l'etape 2 n'est pas touche.
set -uo pipefail
umask 077
ATTENDU_SHA=c492f4a7055ba5f0
S=$(grep -v '^ATTENDU_SHA=' "$0" | sha256sum | cut -c1-16)
[ "$S" = "$ATTENDU_SHA" ] || {
  echo "STOP: script altere au collage ($S)"; exit 1; }
echo "INTEGRITE_SCRIPT=ok"
EMP_V3=42b0cfe09ca64a2b
APP_UUID=l142u3oa8w38xz1zcu6t5lnl
PG=studiio-postgrest
PX=studiio-pgrst-proxy
TS=$(date -u +%Y%m%dT%H%M%SZ)
NEUF=studiio-postgrest-e4-$TS
AVANT=studiio-postgrest-avant-e4-$TS
PORT=${PGRST_PORT_SONDE-3000}
T=$(mktemp -d /root/.pgrst-e4.XXXXXX)
trap 'rm -rf "$T"' EXIT
stop() { echo "STOP: $*"; exit 1; }
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
controle() {
local ATT_LOGIN=$1 Z NZ E L AR S i R RC AN APP
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
echo "=== POSTGREST (login $ATT_LOGIN, anon web_anon) ==="
E=$(docker inspect "$PG" \
  --format '{{range .Config.Env}}{{println .}}{{end}}')
L=$(printf '%s\n' "$E" \
  | sed -nE 's#^PGRST_DB_URI=[a-z]+://([^:@/]+).*#\1#p')
AR=$(printf '%s\n' "$E" \
  | sed -n 's/^PGRST_DB_ANON_ROLE=//p')
echo "PGRST_LOGIN=$L"
echo "PGRST_ANON_ROLE=$AR"
[ "$L" = "$ATT_LOGIN" ] || ko "login_$L"
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
[ "$RC" = service_role ] || ko "cle_$RC"
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
recharger_proxy() {
  docker exec "$PX" nginx -t >/dev/null 2>&1 \
    || { echo "nginx -t KO"; return 1; }
  docker exec "$PX" nginx -s reload
}
roles() { # etat d'authenticator et de service_role
  sqlw <<'SQL'
select 'AUTH', rolcanlogin, rolsuper, rolinherit,
  rolbypassrls, (select string_agg(g.rolname, ','
   order by g.rolname) from pg_auth_members m
   join pg_roles g on g.oid = m.roleid
   where m.member = r.oid)
from pg_roles r where rolname = 'authenticator';
select 'SVC', rolcanlogin, rolsuper, rolbypassrls,
  (select count(*) from pg_auth_members m
   where m.member = r.oid)
from pg_roles r where rolname = 'service_role';
SQL
}
sonde_directe() { # PostgREST $1 joint par son IP
  local ip
  ip=$(docker inspect "$1" --format \
    '{{range .NetworkSettings.Networks}}{{.IPAddress}}
{{end}}' | grep . | head -1)
  docker exec -e U="http://$ip${PORT:+:$PORT}" \
    "$(app_ctr)" \
    node -e '
const k = process.env.SUPABASE_SERVICE_KEY || "";
const v = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const u = process.env.U;
const g = (h) => fetch(u + "/users?select=id&limit=0",
  { headers: h }).then((r) => r.status)
  .catch(() => 0);
(async () => {
  const s = await g({ apikey: k,
    Authorization: "Bearer " + k });
  const a = await g({});
  const o = v ? await g({ apikey: v,
    Authorization: "Bearer " + v }) : 0;
  console.log(s + " " + a + " " + o);
})();' 2>/dev/null
}
echo "=== A. GARDES (lecture seule) ==="
E=$(docker inspect "$PG" \
  --format '{{range .Config.Env}}{{println .}}{{end}}')
URI=$(printf '%s\n' "$E" | sed -n 's/^PGRST_DB_URI=//p')
LOGIN0=$(printf '%s' "$URI" \
  | sed -nE 's#^[a-z]+://([^:@/]+).*#\1#p')
AR=$(printf '%s\n' "$E" \
  | sed -n 's/^PGRST_DB_ANON_ROLE=//p')
IMG=$(docker inspect "$PG" --format '{{.Image}}')
RESTART_POLICY=$(docker inspect "$PG" \
  --format '{{.HostConfig.RestartPolicy.Name}}')
NETS=$(docker inspect "$PG" \
  -f '{{json .NetworkSettings.Networks}}' | python3 -c '
import json,sys
print(" ".join(sorted(json.load(sys.stdin))))')
echo "PGRST_LOGIN=$LOGIN0 PGRST_ANON_ROLE=$AR"
echo "IMAGE_ID=${IMG:7:12} RESTART=$RESTART_POLICY"
echo "RESEAUX=$NETS"
[ "$LOGIN0" = studiio ] || stop "login actuel=$LOGIN0"
[ "$AR" = web_anon ] || stop "anon=$AR"
[ -n "$IMG" ] || stop "image non identifiable"
[ "$NETS" = "coolify studiio-internal" ] \
  || stop "reseaux inattendus"
case "$RESTART_POLICY" in
  no|always|unless-stopped|on-failure) ;;
  *) stop "politique de redemarrage illisible" ;;
esac
RO=$(roles) || stop "lecture des roles"
printf '%s\n' "$RO"
printf '%s\n' "$RO" | grep -qx \
  'AUTH [ft] f f f service_role,web_anon' \
  || stop "authenticator ne correspond pas a #533"
printf '%s\n' "$RO" | grep -qx 'SVC f f t 0' \
  || stop "service_role ne correspond pas a #533"
L0=$(printf '%s\n' "$RO" | awk '/^AUTH/{print $2}')
controle studiio > "$T/avant.txt" \
  || { cat "$T/avant.txt"; stop "controle avant KO"; }
grep -E '^(V3|TABLES_200|SERVICE_KEY_ROLE|ANONYME)' \
  "$T/avant.txt"
echo "=== B. MOT DE PASSE (jamais affiche) ==="
python3 -c '
import secrets; print(secrets.token_hex(32))' > "$T/mdp"
python3 - "$T/mdp" > "$T/scram" <<'PY'
import base64, hashlib, hmac, os, sys
pw = open(sys.argv[1]).read().strip().encode()
sel = os.urandom(16); it = 4096
s = hashlib.pbkdf2_hmac("sha256", pw, sel, it)
ck = hmac.new(s, b"Client Key", "sha256").digest()
sk = hashlib.sha256(ck).digest()
sv = hmac.new(s, b"Server Key", "sha256").digest()
b = lambda x: base64.b64encode(x).decode()
print("SCRAM-SHA-256$%d:%s$%s:%s"
  % (it, b(sel), b(sk), b(sv)))
PY
printf '%s\n' "$E" | python3 -c '
import sys, urllib.parse as u
pw = open(sys.argv[1]).read().strip()
out = []
for l in sys.stdin.read().splitlines():
    if not l.strip():
        continue
    if l.startswith("PGRST_DB_URI="):
        p = u.urlsplit(l[len("PGRST_DB_URI="):])
        h = p.hostname + (":%d" % p.port if p.port else "")
        n = "authenticator:%s@%s" % (pw, h)
        l = "PGRST_DB_URI=" + u.urlunsplit(
            p._replace(netloc=n))
    out.append(l)
print("\n".join(out))' "$T/mdp" > "$T/env"
NV=$(printf '%s\n' "$E" | grep -c '=')
[ "$(grep -c '=' "$T/env")" = "$NV" ] \
  || stop "fichier de variables incoherent"
grep -q '^PGRST_DB_URI=[a-z]*://authenticator:' "$T/env" \
  || stop "URI authenticator non construite"
rm -f "$T/mdp"
echo "VARIABLES_PREPAREES=oui (valeurs non affichees)"
annule_role() {
  if [ "$L0" = f ]; then
    sqlw -q -c 'alter role authenticator nologin
      password null' && echo "AUTHENTICATOR_RESTAURE=oui"
  else
    echo "AUTHENTICATOR_RESTAURE=non (LOGIN preexistant)"
  fi
}
echo "=== C. AUTHENTICATOR : LOGIN ==="
{ printf "alter role authenticator login password '"
  cat "$T/scram" | tr -d '\n'
  printf "';\n"; } | sqlw -q || stop "alter role refuse"
rm -f "$T/scram"
echo "AUTHENTICATOR_LOGIN=oui"
echo "=== D. NOUVEAU POSTGREST A COTE ($NEUF) ==="
echec_neuf() {
  echo "=== R1. ANNULATION ($1) : production intacte ==="
  docker stop "$NEUF" >/dev/null 2>&1
  docker rename "$NEUF" "$NEUF-echec" >/dev/null 2>&1 \
    && echo "CONTENEUR_EN_ECHEC_GARDE=$NEUF-echec"
  annule_role
  echo "ETAPE4_APPLIQUEE=non"
  echo "VERDICT_FINAL=ROLLBACK"
  exit 1
}
docker run -d --name "$NEUF" --restart "$RESTART_POLICY" \
  --network coolify --env-file "$T/env" "$IMG" \
  >/dev/null || echec_neuf "creation"
docker network connect studiio-internal "$NEUF" \
  || echec_neuf "reseau"
rm -f "$T/env"
OK=""
for i in $(seq 1 15); do
  SD=$(sonde_directe "$NEUF")
  case "$SD" in "200 401 "40[13]) OK=1; break ;; esac
  sleep 4
done
echo "SONDE_NOUVEAU service|anonyme|ancienne=${SD:-aucune}"
[ -n "$OK" ] || echec_neuf "nouveau PostgREST non sain"
echo "=== E. ECHANGE ==="
docker stop "$PG" >/dev/null || echec_neuf "arret ancien"
docker rename "$PG" "$AVANT" || {
  docker start "$PG"; echec_neuf "renommage ancien"; }
echo "ANCIEN_GARDE=$AVANT (arrete)"
retour() {
  echo "=== R2. ROLLBACK ($1) ==="
  docker stop "$PG" >/dev/null 2>&1
  docker rename "$PG" "$NEUF-echec" >/dev/null 2>&1 \
    && echo "CONTENEUR_EN_ECHEC_GARDE=$NEUF-echec"
  docker rename "$AVANT" "$PG" && docker start "$PG" \
    >/dev/null && echo "ANCIEN_RESTAURE=oui"
  recharger_proxy && echo "PROXY_RECHARGE=oui"
  pret
  annule_role
  controle studiio \
    | grep -E '^(KO|PGRST_LOGIN|ANONYME|TABLES_200|V3)'
  echo "ETAPE4_APPLIQUEE=non"
  echo "VERDICT_FINAL=ROLLBACK"
  exit 1
}
docker rename "$NEUF" "$PG" || retour "renommage nouveau"
recharger_proxy && echo "PROXY_RECHARGE=oui" \
  || retour "rechargement proxy"
pret || retour "postgrest pas pret"
echo "=== F. CONTROLE ETAPE 4 ==="
controle authenticator > "$T/apres.txt"
CR=$?
grep -vE '^(Z |RPC |TABLE )' "$T/apres.txt"
[ "$CR" = 0 ] || retour "controle"
RO=$(roles) || retour "lecture des roles"
printf '%s\n' "$RO" | grep -qx \
  'AUTH t f f f service_role,web_anon' \
  || retour "authenticator inattendu apres"
SD=$(sonde_directe "$PG")
echo "SONDE_FINALE service|anonyme|ancienne=$SD"
case "$SD" in "200 401 "40[13]) ;;
  *) retour "ancienne cle studiio encore acceptee" ;;
esac
echo "ETAPE4_APPLIQUEE=oui"
echo "ANCIEN_POSTGREST_GARDE=$AVANT (arrete)"
echo "VERDICT_FINAL=VALIDE"
SCRIPT
bash -n /tmp/etape4.sh && echo SYNTAXE_OK
bash /tmp/etape4.sh
