#!/usr/bin/env bash
# PRÉVISUALISATION COMMERCIALE (port 3112) — démarrage propre, réchauffé et vérifié.
#
# ─────────────────────────────────────────────────────────────────────────
# POURQUOI CE SCRIPT EXISTE
# ─────────────────────────────────────────────────────────────────────────
# `next dev` compile chaque page À LA DEMANDE. Deux conséquences, mesurées :
#
#   1. Réécrire les sources sous un serveur actif (`git switch`, `git reset`,
#      `git cherry-pick`, `git stash`) déclenche une recompilation pendant
#      laquelle la route d'authentification répond en erreur
#      (`__webpack_modules__[moduleId] is not a function`). Un visiteur qui
#      arrive à cet instant voit une page BLANCHE — reproduit : 5 éléments à
#      +3 s, rendu complet à +8 s.
#   2. La première visite d'une page froide compile ~700 modules. Machine
#      saturée (swap), cela dure des minutes : « chargement interminable ».
#
# RÈGLE : ARRÊTER le serveur AVANT de toucher aux branches, le relancer APRÈS.
#   ./scripts/apercu-commerce.sh stop    puis  git …    puis  … start
#
# Ce script ne tue JAMAIS un serveur qui n'est pas celui de CE worktree : les
# ports 3110, 3111 et les autres chantiers ne sont pas concernés.
set -euo pipefail

PORT=3112
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JOURNAL="${TMPDIR:-/tmp}/studiio-commerce-${PORT}.log"
ACTION="${1:-start}"

pid_ecoute() { lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true; }

repertoire_de() { lsof -p "$1" 2>/dev/null | awk '$4=="cwd"{print $NF}' | head -1; }

arreter() {
  local pid; pid="$(pid_ecoute)"
  if [ -z "$pid" ]; then echo "port $PORT : libre."; return 0; fi
  local cwd; cwd="$(repertoire_de "$pid")"
  if [ "$cwd" != "$RACINE" ]; then
    echo "REFUS : le port $PORT est tenu par un serveur d'un AUTRE répertoire ($cwd)." >&2
    echo "Je ne l'arrête pas." >&2
    exit 2
  fi
  echo "arrêt du serveur $pid (ce worktree)…"
  kill "$pid" 2>/dev/null || true
  # Le parent `next dev` meurt avec son enfant ; on attend la libération du port.
  for _ in $(seq 1 20); do [ -z "$(pid_ecoute)" ] && break; sleep 1; done
  if [ -n "$(pid_ecoute)" ]; then kill -9 "$(pid_ecoute)" 2>/dev/null || true; sleep 1; fi
  echo "port $PORT libéré."
}

demarrer() {
  cd "$RACINE"
  [ -f .env.local ] || { echo "REFUS : .env.local absent (identité de démonstration)." >&2; exit 2; }
  grep -q '^DEV_AUTH_BYPASS=1' .env.local || { echo "REFUS : DEV_AUTH_BYPASS=1 absent de .env.local." >&2; exit 2; }

  arreter
  # Cache neuf : un `.next` à moitié réécrit est la cause de la page blanche.
  rm -rf .next
  : > "$JOURNAL"
  echo "démarrage de next dev sur $PORT (journal : $JOURNAL)…"
  nohup npx next dev -p "$PORT" >> "$JOURNAL" 2>&1 &
  disown || true

  echo "attente de l'écoute…"
  for _ in $(seq 1 60); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://localhost:$PORT/api/mode" 2>/dev/null || true)" != "000" ] && break
    sleep 2
  done

  # RÉCHAUFFEMENT : on compile ICI, dans l'ordre, ce que l'utilisateur ouvrira.
  # La première visite n'a plus rien à compiler.
  echo "réchauffement des routes (la première prend du temps, c'est normal) :"
  for chemin in \
      /api/auth/session /api/mode /api/pricing /api/credits/balance \
      /api/billing/summary /api/paiements/mobile-money/disponible \
      "/dashboard/settings?tab=abonnement" /admin/paiements/mobile-money ; do
    printf '  %-48s ' "$chemin"
    curl -s -o /dev/null -w '%{http_code} en %{time_total}s\n' --max-time 300 "http://localhost:$PORT$chemin" || echo "ECHEC"
  done

  verifier
}

verifier() {
  cd "$RACINE"
  # Le serveur DOIT être vivant : un démarrage qui meurt aussitôt ne doit pas
  # passer pour un succès.
  local pid; pid="$(pid_ecoute)"
  [ -n "$pid" ] || { echo "ÉCHEC : plus rien n'écoute sur $PORT. Journal : $JOURNAL" >&2; exit 1; }
  echo "serveur $pid vivant. Vérification dans un vrai navigateur…"
  node scripts/apercu-commerce-verifier.mjs "http://localhost:$PORT"
}

case "$ACTION" in
  start|restart) demarrer ;;
  stop)          arreter ;;
  check)         verifier ;;
  *) echo "usage : $0 [start|stop|check]" >&2; exit 64 ;;
esac
