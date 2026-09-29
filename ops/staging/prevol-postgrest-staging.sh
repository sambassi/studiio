#!/usr/bin/env bash
# STUDIIO STAGING UNIQUEMENT — pre-vol LECTURE SEULE (roles, PGRST_*, claims, proxy, appels anonymes)
# PR #474 (postgrest moindre privilege). Aucun secret affiche. A lancer en root sur l'hote (terminal Coolify).
NOM=prevol-postgrest
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
PXURL="$(envde "$APP" SUPABASE_URL)"; PXURL="${PXURL%/}"
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

echo; echo "== 1. Roles de la base staging =="
q "select rolname||' super='||rolsuper||' login='||rolcanlogin||' bypassrls='||rolbypassrls||' inherit='||rolinherit from pg_roles where rolname !~ '^pg_' order by rolname" | sed 's/^/  /'
for r in web_anon service_role authenticator; do
  if [ "$(q "select count(*) from pg_roles where rolname='$r'")" = 1 ]; then info "role $r present"; else warn "role $r ABSENT (migration #474 pas encore appliquee)"; fi
done
[ "$(q "select count(*) from pg_roles where rolname !~ '^pg_' and rolcanlogin and rolname not in ('$PSU','$DU','authenticator')")" = 0 ] \
  && ok "aucun autre role LOGIN" || warn "autre role LOGIN present : il perdra USAGE sur public (runbook 0.a)"
info "USAGE public pour PUBLIC : $(q "select has_schema_privilege('public','public','usage')")"

echo; echo "== 2. PostgREST staging : noms des variables PGRST_* (valeurs non affichees) =="
envnoms "$PG" | grep '^PGRST_' | sed 's/^/  /'
info "PGRST_DB_ANON_ROLE=$(envde "$PG" PGRST_DB_ANON_ROLE)   (valeur non secrete)"
info "PGRST_DB_URI utilisateur=$DU (mot de passe non affiche)"
info "PGRST_DB_SCHEMAS=$(envde "$PG" PGRST_DB_SCHEMAS)  PGRST_JWT_SECRET_IS_BASE64=$(envde "$PG" PGRST_JWT_SECRET_IS_BASE64)  PGRST_JWT_AUD=$( [ -n "$(envde "$PG" PGRST_JWT_AUD)" ] && echo pose || echo absent)"
for v in PGRST_JWT_ROLE_CLAIM_KEY PGRST_DB_PRE_REQUEST; do [ -z "$(envde "$PG" $v)" ] || warn "$v pose : STOP runbook 0.b, a analyser"; done
S="$(envde "$PG" PGRST_DB_SCHEMAS)"; case "${S:-public}" in public) ok "schemas exposes = public";; *) warn "PGRST_DB_SCHEMAS != public : STOP runbook 0.b";; esac; unset S
if [ "$(envde "$PG" PGRST_JWT_SECRET | cut -c1)" = "{" ]; then warn "PGRST_JWT_SECRET ressemble a un JWK : generateur HS256 inapplicable"; else ok "PGRST_JWT_SECRET = chaine (HS256)"; fi
[ -z "$(docker port "$PG" 2>/dev/null)" ] && ok "postgrest staging : aucun port publie sur l'hote" || warn "postgrest staging publie un port : $(docker port "$PG" | xargs)"

echo; echo "== 3. Cles de l'app staging : claim role seulement =="
docker exec "$APP" node -e '
for (const k of ["SUPABASE_SERVICE_KEY","SUPABASE_SERVICE_ROLE_KEY","NEXT_PUBLIC_SUPABASE_ANON_KEY"]) {
  const t = process.env[k]; if (!t) { console.log("  "+k+" ABSENTE"); continue; }
  try { const p = JSON.parse(Buffer.from(t.split(".")[1], "base64url"));
        let e = "non"; if (p.exp) { const j = Math.round((p.exp*1000-Date.now())/864e5); e = "oui (dans "+j+" j)"; }
        console.log("  "+k+" role="+p.role+" aud="+(p.aud?"pose":"-")+" iss="+(p.iss?"pose":"-")+" exp="+e); }
  catch { console.log("  "+k+" illisible (pas un JWT)"); } }
const h = (v) => { try { return new URL(v).host } catch { return v ? "illisible" : "ABSENTE" } };
console.log("  SUPABASE_URL hote=" + h(process.env.SUPABASE_URL) + "  NEXT_PUBLIC_SUPABASE_URL hote=" + h(process.env.NEXT_PUBLIC_SUPABASE_URL));
' | tee "$D/.prevol-cles-$TS"
grep -q 'SUPABASE_SERVICE_KEY ABSENTE' "$D/.prevol-cles-$TS" && warn "SUPABASE_SERVICE_KEY ABSENTE : STOP runbook 0.c"
grep -q 'NEXT_PUBLIC_SUPABASE_ANON_KEY role=studiio' "$D/.prevol-cles-$TS" && warn "cle ANON publique porte role=studiio : superuser publie dans le bundle, accelerer l'ETAPE 2"
rm -f "$D/.prevol-cles-$TS"

echo; echo "== 4. Proxy staging : injecte-t-il un Authorization / apikey ? =="
info "image proxy : $(docker inspect "$PROXY" --format '{{.Config.Image}}')"
info "domaines publics du proxy (labels) : ${PXHOSTS:-aucun}"
# Sources candidates : labels, Cmd/Entrypoint, env, fichiers de conf. Les lignes trouvees
# passent par un tube vers node, qui n'imprime QUE oui/non et le claim role d'un JWT eventuel.
{
  docker inspect "$PROXY" --format '{{range $k,$v := .Config.Labels}}{{println $k "=" $v}}{{end}}{{json .Config.Cmd}}{{println}}{{json .Config.Entrypoint}}{{println}}{{range .Config.Env}}{{println .}}{{end}}'
  docker exec "$PROXY" sh -c 'for d in /etc/nginx /etc/caddy /etc/traefik /etc/haproxy /usr/local/etc/haproxy /usr/local/openresty/nginx/conf /config /etc/envoy; do [ -e "$d" ] && grep -rhiE "authorization|apikey|bearer|proxy_set_header|header_up|customrequestheaders" "$d" 2>/dev/null; done; true' 2>/dev/null || true
} | docker exec -i "$APP" node -e '
let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
  const lignes = s.split("\n").filter(l => /authorization|apikey|bearer/i.test(l));
  const roles = new Set();
  for (const m of s.matchAll(/eyJ[A-Za-z0-9_-]+\.(eyJ[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
    try { roles.add(JSON.parse(Buffer.from(m[1], "base64url")).role || "?"); } catch { roles.add("illisible"); } }
  console.log("PROXY_INJECTE_AUTH=" + (lignes.length ? "oui" : "non") + " lignes=" + lignes.length + " roles_jwt=" + ([...roles].join(",") || "aucun"));
});' | tee "$D/.prevol-px-$TS"
grep -q 'PROXY_INJECTE_AUTH=non' "$D/.prevol-px-$TS" && ok "proxy : aucune injection d'Authorization/apikey detectee dans sa conf" \
  || warn "proxy : mention Authorization/apikey trouvee dans sa conf -> STOP runbook 0.d tant que non analyse (peut etre un simple passage d'en-tete client)"
rm -f "$D/.prevol-px-$TS"

echo; echo "== 5. Appels ANONYMES depuis $NET (codes HTTP seulement, aucun effet) =="
[ "$RPC_EXISTE" = t ] && info "crediter_credits_stripe presente : appelee avec un user inexistant ($NIL) -> utilisateur_inconnu, rien credite" || info "crediter_credits_stripe absente : RPC non appelee"
[ "$(q "select to_regclass('public.credit_transactions') is not null")" = t ] || fail "table credit_transactions absente"
NBCT0="$(q "select count(*) from public.credit_transactions")"
echo " direct postgrest ($PGURL) :"; anon_batterie "$PGURL" direct
echo " via proxy ($PXURL) :";        anon_batterie "$PXURL" proxy
for h in $PXHOSTS; do
  c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$h/users?select=id&limit=1" || true)"; echo "  public https://$h GET /users -> ${c:-000}"
done
[ "$(q "select count(*) from public.credit_transactions")" = "$NBCT0" ] && ok "credit_transactions inchangee ($NBCT0 lignes)" || fail "credit_transactions a change pendant le pre-vol !"
if [ "$A_direct_users" = 200 ] || [ "$A_proxy_users" = 200 ]; then warn "FAILLE CONFIRMEE : anonyme lit /users (200) — attendu avant bascule"; else info "anonyme deja refuse sur /users"; fi

trap - ERR; fin
