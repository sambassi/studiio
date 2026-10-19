#!/bin/sh
# STUDIIO — SUPPRESSION DÉFINITIVE des anciens fichiers media/converted/<horodatage> (clé SANS compte).
# À lancer APRÈS 1-inventaire.lecture-seule.sh, sur le serveur, en root.
#   sh 2-suppression-converted.sh              -> SIMULATION (rien n'est supprimé)
#   CONFIRMER=OUI sh 2-suppression-converted.sh -> suppression réelle
# Supprime UNIQUEMENT des clés exactes sous media/converted/, une par une (jamais --recursive,
# jamais de joker, jamais de compartiment). Ne touche pas à <uid>/converted/ (nouveau format).
# Un fichier encore cité par un post non publié (brouillon, programmé, en cours, échoué)
# ou par une vidéo de la bibliothèque est CONSERVÉ et signalé.
set -eu

MINIO=studiio-minio
OUT=/root/studiio-nettoyage
OBJ="$OUT/converted-objets.txt"
REF="$OUT/converted-references.txt"
[ -s "$OBJ" ] || { echo "ARRET : lancez d'abord l'inventaire ($OBJ absent ou vide)."; exit 1; }
[ -f "$REF" ] || { echo "ARRET : $REF absent."; exit 1; }
docker ps --format '{{.Names}}' | grep -qx "$MINIO" || { echo "ARRET : $MINIO introuvable."; exit 1; }
# Connexion par variable d'environnement MC_HOST_loc : rien n'est écrit dans le conteneur (pas de `mc alias set`).
mcx() { docker exec "$MINIO" sh -c '[ -n "${MINIO_ROOT_USER:-}" ] && [ -n "${MINIO_ROOT_PASSWORD:-}" ] || { echo "ARRET : identifiants MinIO absents du conteneur." >&2; exit 3; }; MC_HOST_loc="http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@127.0.0.1:9000" mc --quiet --config-dir /tmp/.mc-studiio-nettoyage "$@"' mc "$@"; }

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
PROTEGES="$OUT/conserves-$STAMP.txt"; A_SUPPR="$OUT/a-supprimer-$STAMP.txt"; FAIT="$OUT/supprimes-$STAMP.txt"

# Clés protégées : citées par une vidéo, ou par un post qui n'est pas « published ».
awk -F'|' '$1=="video" || ($1=="post" && $3!="published") {print $4}' "$REF" | sort -u > "$PROTEGES"

# Candidats : clé à la racine de converted/ seulement (pas de sous-dossier), nom sûr.
: > "$A_SUPPR"
while IFS='|' read -r cle taille date; do
  case "$cle" in */*|*..*|'' ) echo "IGNORE (forme inattendue) : $cle"; continue;; esac
  printf '%s' "$cle" | grep -Eq '^[A-Za-z0-9._-]+$' || { echo "IGNORE (caractères) : $cle"; continue; }
  if grep -qixF "$cle" "$PROTEGES"; then echo "CONSERVE (référencé) : $cle"; continue; fi
  printf '%s|%s|%s\n' "$cle" "$taille" "$date" >> "$A_SUPPR"
done < "$OBJ"

N=$(wc -l < "$A_SUPPR" | tr -d ' ')
T=$(awk -F'|' '{s+=$2} END {printf "%.1f Mo", s/1048576}' "$A_SUPPR")
echo "Conservés (référencés) : $(wc -l < "$PROTEGES" | tr -d ' ')   À supprimer : $N ($T)"
echo "Inventaire des chemins : $A_SUPPR"

if [ "${CONFIRMER:-}" != "OUI" ]; then echo "SIMULATION — rien n'a été supprimé. Relancer avec CONFIRMER=OUI."; exit 0; fi

: > "$FAIT"
while IFS='|' read -r cle taille date; do
  if mcx rm "loc/media/converted/$cle" >/dev/null 2>&1; then echo "media/converted/$cle|$taille|$date" >> "$FAIT"
  else echo "ECHEC : media/converted/$cle"; fi
done < "$A_SUPPR"

# Vérification : chaque clé supprimée doit être absente de MinIO.
RESTE=0
while IFS='|' read -r chemin _ _; do
  if mcx stat "loc/$chemin" >/dev/null 2>&1; then echo "ENCORE PRÉSENT : $chemin"; RESTE=$((RESTE+1)); fi
done < "$FAIT"
echo "Supprimés : $(wc -l < "$FAIT" | tr -d ' ')   encore présents : $RESTE   (liste : $FAIT)"
