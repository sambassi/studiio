cat > /tmp/audit-exposition.sh <<'SCRIPT'
#!/usr/bin/env bash
# AUDIT LECTURE SEULE : exposition de PostgREST.
# Aucune ecriture. Valeurs sensibles masquees.
set -uo pipefail
masque() {
  python3 -c '
import re,sys
m=r"(authorization|apikey|password|passwd|secret"
m+=r"|token|basicauth|key)([^=: ]*[=: ]+).*"
for l in sys.stdin:
    l=l.rstrip("\n")
    print(re.sub(m,r"\1\2[MASQUE]",l,flags=re.I))
'
}
APP=$(docker ps --filter name=l142u3oa8w38xz1zcu6t5lnl \
  --format '{{.Names}}' | head -1)
echo "--- 1. APPLICATION -> POSTGREST ---"
if [ -n "$APP" ]; then
  U=$(docker exec "$APP" printenv SUPABASE_URL 2>/dev/null)
  # schema + hote + port + chemin, jamais d'identifiant
  U=$(printf '%s' "$U" | sed -E 's#//[^@/]*@#//#')
  echo "APP_SUPABASE_URL=${U:-absente}"
fi
echo "--- 2. CONTENEURS ---"
CIBLES=""
while read -r nom image; do
  case "$nom $image" in
    *postgrest*|*pgrst*) CIBLES="$CIBLES $nom" ;;
  esac
done < <(docker ps --format '{{.Names}} {{.Image}}')
for c in $CIBLES; do
  echo "== CONTENEUR=$c"
  docker inspect -f 'IMAGE={{.Config.Image}}' "$c"
  docker inspect -f '{{json .NetworkSettings.Networks}}' \
    "$c" | python3 -c '
import json,sys
for n,v in json.load(sys.stdin).items():
    a=",".join(v.get("Aliases") or [])
    print("RESEAU="+n+" ALIAS="+a)
'
  docker port "$c" 2>/dev/null \
    | sed 's/^/PORT_PUBLIE=/' || true
  docker inspect -f \
    '{{range $k,$v := .Config.Labels}}{{$k}}={{$v}}
{{end}}' "$c" | grep -iE 'traefik|caddy' \
    | masque | sed 's/^/LABEL=/'
  echo "-- configuration du proxy (masquee) --"
  docker exec "$c" sh -c \
    'cat /etc/nginx/conf.d/*.conf /etc/nginx/nginx.conf \
     /etc/caddy/Caddyfile 2>/dev/null' 2>/dev/null \
    | grep -vE '^\s*(#|$)' | masque | head -80
done
echo "--- 3. ACCES SANS JETON (GET, code seul) ---"
IPPUB=$(curl -s -m 5 https://api.ipify.org || true)
echo "IP_PUBLIQUE_SERVEUR=${IPPUB:-inconnue}"
for c in $CIBLES; do
  for p in $(docker port "$c" 2>/dev/null \
    | sed -nE 's/.*:([0-9]+)$/\1/p' | sort -u); do
    for h in 127.0.0.1 ${IPPUB:-}; do
      C=$(curl -s -o /dev/null -m 8 -w '%{http_code}' \
        "http://$h:$p/users?select=id&limit=1")
      echo "HOTE_PORT $c $h:$p /users=$C"
      C=$(curl -s -o /dev/null -m 8 -w '%{http_code}' \
        "http://$h:$p/rest/v1/users?select=id&limit=1")
      echo "HOTE_PORT $c $h:$p /rest/v1/users=$C"
    done
  done
done
DOM=$(for c in $CIBLES; do
  docker inspect -f \
    '{{range $k,$v := .Config.Labels}}{{$v}}
{{end}}' "$c"; done \
  | grep -oE 'Host\(`[^`]+`\)|https?://[a-z0-9.-]+' \
  | sed -E 's/Host\(`//; s/`\)//; s#https?://##' \
  | sort -u)
for d in $DOM studiio.pro; do
  for chemin in /users /rest/v1/users; do
    C=$(curl -s -o /dev/null -m 8 -w '%{http_code}' \
      "https://$d$chemin?select=id&limit=1")
    echo "PUBLIC https://$d$chemin=$C"
  done
done
echo "AUDIT_EXPOSITION_TERMINE=oui"
SCRIPT
bash -n /tmp/audit-exposition.sh && echo SYNTAXE_OK
bash /tmp/audit-exposition.sh
