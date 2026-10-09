cat > /tmp/audit-complement.sh <<'SCRIPT'
#!/usr/bin/env bash
# VERIFICATION COMPLEMENTAIRE — LECTURE SEULE.
# Studiio seulement : studiio-postgrest et proxy.
# Aucune ecriture, valeurs sensibles masquees.
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
MOTIF='studiio-pgrst|studiio-postgrest'
C=$(docker ps --format '{{.Names}}' | grep -E "$MOTIF")
echo "CONTENEURS=$(echo $C)"
echo "--- 1. Ports publies (tous conteneurs Studiio) ---"
docker ps --format '{{.Names}} PORTS={{.Ports}}' \
  | grep -E "$MOTIF"
echo "--- 2. Labels citant ces services ---"
for n in $(docker ps --format '{{.Names}}'); do
  docker inspect -f \
    '{{range $k,$v := .Config.Labels}}{{$k}}={{$v}}
{{end}}' "$n" | grep -E "$MOTIF" | masque \
    | sed "s/^/LABEL $n /"
done
echo "--- 3. Configuration dynamique du proxy Coolify ---"
for d in /data/coolify/proxy /data/coolify/proxy/dynamic \
  /data/coolify/proxy/caddy; do
  [ -d "$d" ] && echo "DOSSIER $d"
done
grep -rnE "$MOTIF|:3000" /data/coolify/proxy \
  2>/dev/null | masque | sed 's/^/CONFIG /' | head -40
echo "CONFIG_FIN"
echo "--- 4. Traefik : exposition par defaut ---"
for p in coolify-proxy; do
  docker inspect -f '{{json .Args}} {{json .Config.Cmd}}' \
    "$p" 2>/dev/null | tr ',' '\n' \
    | grep -iE 'exposedbydefault|providers\.(docker|file)' \
    | sed 's/^/TRAEFIK /'
done
grep -rniE 'exposedbydefault' /data/coolify/proxy \
  2>/dev/null | sed 's/^/TRAEFIK_FICHIER /'
echo "--- 5. Regles NAT vers ces conteneurs ---"
for n in $C; do
  for ip in $(docker inspect -f \
    '{{range .NetworkSettings.Networks}}{{.IPAddress}}
{{end}}' \
    "$n"); do
    echo "IP $n $ip"
    iptables -t nat -S 2>/dev/null | grep -F -- "$ip" \
      | sed 's/^/NAT /'
  done
done
echo "NAT_FIN"
echo "--- 6. Ecoute hote sur 3000 ---"
ss -ltn 2>/dev/null | awk '$4 ~ /:3000$/' \
  | sed 's/^/ECOUTE /'
echo "ECOUTE_FIN"
echo "--- 7. Sondes publiques directes (code seul) ---"
IP=178.105.201.62
for u in "http://$IP:3000/users?limit=1" \
  "http://$IP/rest/v1/users?limit=1" \
  "https://$IP/rest/v1/users?limit=1"; do
  c=$(curl -sk -o /dev/null -m 8 -w '%{http_code}' "$u")
  echo "SONDE $u=$c"
done
for h in studiio-pgrst-proxy studiio-postgrest; do
  c=$(curl -sk -o /dev/null -m 8 -w '%{http_code}' \
    -H "Host: $h" "https://$IP/rest/v1/users?limit=1")
  echo "SONDE_HOST $h=$c"
done
echo "--- 8. Voisins sur le reseau coolify (nombre) ---"
N=$(docker network inspect coolify -f \
  '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null \
  | wc -w)
echo "CONTENEURS_SUR_COOLIFY=$N"
echo "AUDIT_COMPLEMENT_TERMINE=oui"
SCRIPT
bash -n /tmp/audit-complement.sh && echo SYNTAXE_OK
bash /tmp/audit-complement.sh
