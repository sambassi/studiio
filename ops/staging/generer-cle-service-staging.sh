#!/usr/bin/env bash
# STUDIIO STAGING UNIQUEMENT — genere la cle serveur role=service_role (fichier 600)
# PR #474 (postgrest moindre privilege). Aucun secret affiche. A lancer en root sur l'hote (terminal Coolify).
NOM=cle-service
# ── Commun : identification STAGING par alias réseau (modèle stg2.sh), garde anti-prod ──
set -euo pipefail
umask 077
TS="$(date +%Y%m%d-%H%M%S)"; D="/root/studiio-staging-backups"; mkdir -p "$D"; chmod 700 "$D"
LOG="$D/$NOM-$TS.log"; exec > >(tee -a "$LOG") 2>&1
R=(); ok(){ R+=("PASS  $1"); echo "[PASS] $1"; }; info(){ echo "[INFO] $1"; }
warn(){ R+=("WARN  $1"); echo "[WARN] $1"; }; ko(){ R+=("FAIL  $1"); echo "[FAIL] $1"; }
fin(){ echo "== RESUME =="; printf '%s\n' "${R[@]}"; echo "Journal: $LOG"; }
fail(){ ko "$1"; fin; exit 1; }
trap 'fail "erreur inattendue ligne $LINENO"' ERR
NET=staging-net
CURLIMG=curlimages/curl:8.10.1
envde(){ docker inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n "s/^$2=//p"; }
envnoms(){ docker inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed 's/=.*//'; }
alias_on(){ local c; for c in $(docker ps --format '{{.Names}}'); do
  if docker inspect "$c" --format "{{with index .NetworkSettings.Networks \"$1\"}}{{range .Aliases}}{{println .}}{{end}}{{end}}" 2>/dev/null | grep -qx "$2"; then echo "$c"; fi; done; return 0; }
un(){ [ "$(printf '%s\n' $2 | grep -c .)" = 1 ] || fail "$1 introuvable ou ambigu [$2]"; }

docker network inspect "$NET" >/dev/null 2>&1 || fail "reseau $NET absent"
PG="$(alias_on "$NET" studiio-staging-postgrest)";      un "postgrest staging" "$PG"
PROXY="$(alias_on "$NET" studiio-staging-pgrst-proxy)"; un "proxy staging" "$PROXY"
APP=""; for c in $(docker ps --format '{{.Names}}'); do
  if envde "$c" SUPABASE_URL | grep -qE '^http://studiio-staging-pgrst-proxy(:[0-9]+)?/?$'; then APP="${APP:+$APP }$c"; fi; done
un "app staging" "$APP"
U="$(envde "$PG" PGRST_DB_URI)"
H="$(printf '%s' "$U" | sed -nE 's#^[a-z]+://([^:@/]*)(:[^@]*)?@([^:/?]+).*#\3#p')"
DU="$(printf '%s' "$U" | sed -nE 's#^[a-z]+://([^:@/]+).*@.*#\1#p')"
DN="$(printf '%s' "$U" | sed -nE 's#^[a-z]+://[^/]*/([^?]+).*#\1#p')"; unset U
for v in "$H" "$DU" "$DN"; do [[ "$v" =~ ^[A-Za-z0-9._-]+$ ]] || fail "PGRST_DB_URI illisible"; done
DB="$(alias_on "$NET" "$H")"; un "db staging" "$DB"
case "$DB" in studiio-db|studiio-db-*) fail "db = PRODUCTION ($DB) : STOP";; esac
for c in $PG $PROXY $APP $DB; do
  NETS="$(docker inspect "$c" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}')"
  echo " $NETS " | grep -q " $NET " || fail "$c pas sur $NET"
done
# Super-utilisateur de la base staging, pour les lectures catalogue (jamais authenticator)
PSU="$(envde "$DB" POSTGRES_USER)"; PSU="${PSU:-$DU}"; [[ "$PSU" =~ ^[A-Za-z0-9._-]+$ ]] || fail "POSTGRES_USER illisible"
q(){ docker exec -i "$DB" psql -X -q -v ON_ERROR_STOP=1 -U "$PSU" -d "$DN" -At -c "$1" </dev/null; }
PGPORT="$(envde "$PG" PGRST_SERVER_PORT)"; PGPORT="${PGPORT:-3000}"
PGURL="http://studiio-staging-postgrest:$PGPORT"
PXURL="$(envde "$APP" SUPABASE_URL)"; PXURL="${PXURL%/}/rest/v1"
echo "STAGING : app=$APP postgrest=$PG proxy=$PROXY db=$DB user_uri=$DU base=$DN"
# curl depuis staging-net ; n'affiche que le code HTTP. $1=methode $2=url, reste = options curl
hc(){ local m="$1" u="$2" r; shift 2; r="$(docker run --rm -i --network "$NET" "$CURLIMG" -s -o /dev/null -w '%{http_code}' --max-time 15 -X "$m" "$@" "$u" </dev/null 2>/dev/null || true)"; echo "${r:-000}"; }
# idem avec en-tetes lus sur stdin (jeton jamais dans argv)
hcs(){ local m="$1" u="$2" r; shift 2; r="$(docker run --rm -i --network "$NET" "$CURLIMG" -s -o /dev/null -w '%{http_code}' --max-time 15 -X "$m" -H @- "$@" "$u" 2>/dev/null || true)"; echo "${r:-000}"; }
NIL=00000000-0000-0000-0000-000000000000
RPC_EXISTE="$(q "select to_regprocedure('public.crediter_credits_stripe(uuid,integer,text,text,text,text)') is not null")"
# Batterie d'appels ANONYMES (aucun effet de bord). $1=base url $2=etiquette ; remplit ANON_<etiq>
anon_batterie(){ local B="$1" T="$2" c n
  c="$(hc GET "$B/users?select=id&limit=1")";               echo "  $T GET  /users?limit=1          -> $c"; eval "A_${T}_users=$c"
  c="$(hc PATCH "$B/users?id=eq.$NIL" -H 'Content-Type: application/json' -H 'Prefer: return=minimal' -d '{"credits":0}')"
                                                               echo "  $T PATCH /users?id=eq.<nil>     -> $c"; eval "A_${T}_patch=$c"
  if [ "$RPC_EXISTE" = t ]; then
    [ "$(q "select count(*) from public.users where id='$NIL'")" = 0 ] || fail "un user $NIL existe : RPC non jouee"
    c="$(hc POST "$B/rpc/crediter_credits_stripe" -H 'Content-Type: application/json' \
         -d "{\"p_user_id\":\"$NIL\",\"p_montant\":1,\"p_type\":\"bonus\",\"p_reference\":\"stripe:diag-prevol-inexistant\"}")"
                                                               echo "  $T POST /rpc/crediter_credits_stripe (user nul) -> $c"; eval "A_${T}_rpc=$c"
  else echo "  $T POST /rpc/crediter_credits_stripe  -> non joue (fonction absente)"; eval "A_${T}_rpc=na"; fi
  c="$(hc GET "$B/subscriptions?select=id&limit=1")";        echo "  $T GET  /subscriptions          -> $c"; eval "A_${T}_subs=$c"
  c="$(hc GET "$B/credit_transactions?select=id&limit=1")";  echo "  $T GET  /credit_transactions    -> $c"; eval "A_${T}_ct=$c"
  n="$(docker run --rm -i --network "$NET" "$CURLIMG" -s --max-time 15 "$B/" </dev/null 2>/dev/null \
      | docker exec -i "$APP" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const p=Object.keys(j.paths||{}).filter(k=>k!=="/"&&!k.startsWith("/rpc/"));console.log(p.length)}catch{console.log("illisible")}})' 2>/dev/null || true)"; n="${n:-illisible}"
                                                               echo "  $T GET  / (OpenAPI) tables listees -> $n"; eval "A_${T}_oapi=$n"
}
# Domaines publics du proxy (labels traefik/caddy Coolify) — non secrets
PXHOSTS="$(docker inspect "$PROXY" --format '{{range $k,$v := .Config.Labels}}{{println $v}}{{end}}' | grep -oE 'Host\(`[^`]+`\)' | sed -E 's/Host\(`([^`]+)`\)/\1/' | sort -u | xargs || true)"

# ── Preconditions ──
[ "$(q "select count(*) from pg_roles where rolname='service_role'")" = 1 ] || fail "role service_role absent : appliquer d'abord la migration #474 sur le staging"
[ "$(q "select has_table_privilege('service_role','public.users','select')")" = t ] || fail "service_role n'a pas SELECT sur users : migration incomplete"
[ -n "$(envde "$PG" PGRST_JWT_SECRET)" ] || fail "PGRST_JWT_SECRET absent du postgrest staging"
[ "$(envde "$PG" PGRST_JWT_SECRET | cut -c1)" != "{" ] || fail "PGRST_JWT_SECRET est un JWK : generateur HS256 inapplicable, STOP"
[ -z "$(envde "$PG" PGRST_JWT_ROLE_CLAIM_KEY)" ] || fail "PGRST_JWT_ROLE_CLAIM_KEY pose : claim 'role' non standard, STOP"
B64="$(envde "$PG" PGRST_JWT_SECRET_IS_BASE64)"

# ── Ancienne cle : claims resumes (jamais le jeton) + copie 600 pour rollback / test ETAPE 2 ──
docker exec "$APP" node -e '
const t = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!t) { console.log("ANCIENNE=ABSENTE"); process.exit(0); }
const p = JSON.parse(Buffer.from(t.split(".")[1], "base64url"));
const exp = p.exp ? "present, expire dans " + Math.round((p.exp*1000-Date.now())/864e5) + " j" : "absent";
console.log("ANCIENNE role=" + p.role + " exp=" + exp + " claims=" + Object.keys(p).sort().join(","));'
OLD="$D/service-key-ancienne-$TS.jwt"
docker exec "$APP" node -e 'process.stdout.write(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "")' > "$OLD"
chmod 600 "$OLD"; [ -s "$OLD" ] && info "ancienne cle copiee (600) : $OLD — a shred -u apres ETAPE 2 validee" || { rm -f "$OLD"; warn "pas d'ancienne cle a copier"; }

# ── Generation : secret -> tube -> node (dans l'app), jeton -> fichier 600. Rien a l'ecran. ──
OUT="$D/service-key-$TS.jwt"
set +e
envde "$PG" PGRST_JWT_SECRET | docker exec -i -e B64="$B64" "$APP" node -e '
  const c = require("crypto");
  const s = require("fs").readFileSync(0, "utf8").replace(/\n$/, "");
  if (!s) process.exit(4);
  const key = process.env.B64 === "true" ? Buffer.from(s, "base64") : s;
  const old = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").split(".")[1];
  const prev = old ? JSON.parse(Buffer.from(old, "base64url")) : {};
  const now = Math.floor(Date.now() / 1000);
  const claims = { ...prev, role: "service_role", iat: now };
  if (prev.exp) { if (prev.exp - now < 365 * 86400) process.exit(3); }   // exp herite trop court : on refuse
  else delete claims.exp;                                                  // comme l ancienne : pas d exp
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg: "HS256", typ: "JWT" }), p = b(claims);
  process.stdout.write(h + "." + p + "." + c.createHmac("sha256", key).update(h + "." + p).digest("base64url"));
' > "$OUT"
RC=$?; set -e
chmod 600 "$OUT"
case "$RC" in 0) :;; 3) rm -f "$OUT"; fail "ancienne cle : exp < 365 j, refus de recopier un exp court (decider d'un exp explicite)";;
  *) rm -f "$OUT"; fail "generation echouee (code $RC)";; esac
ROLE="$(docker exec -i "$APP" node -e 'const t=require("fs").readFileSync(0,"utf8");const a=t.split(".");if(a.length!==3){console.log("MALFORME");process.exit(0)}const p=JSON.parse(Buffer.from(a[1],"base64url"));console.log(p.role+" exp="+(p.exp?"oui":"non"))' < "$OUT")"
[ "${ROLE%% *}" = service_role ] || { shred -u "$OUT" 2>/dev/null || rm -f "$OUT"; fail "jeton genere invalide ($ROLE)"; }
info "nouveau jeton : role=$ROLE, $(stat -c '%a %s octets' "$OUT")"

# ── Test direct sur le postgrest staging (jeton via stdin -> curl -H @-, jamais dans argv) ──
hdr(){ printf 'Authorization: Bearer '; tr -d '\n' < "$1"; printf '\n'; }
T1="$(hdr "$OUT" | hcs GET "$PGURL/users?select=id&limit=1")"
T2="$(hdr "$OUT" | hcs GET "$PGURL/subscriptions?select=id&limit=1")"
info "test direct : /users=$T1 /subscriptions=$T2"
[ "$T1" = 200 ] || { shred -u "$OUT" 2>/dev/null || rm -f "$OUT"; fail "la nouvelle cle n'obtient pas 200 sur /users ($T1) — fichier detruit"; }
ok "nouvelle cle service_role acceptee par le postgrest staging"
trap - ERR
echo "CLE_GENEREE=OUI chemin=$OUT test=$T1"
fin
