#!/bin/sh
# Exemples de la galerie « Styles vidéo » (Créer) — extraits de VRAIS rendus du compositeur Créer.
#
#   DEMOS=/chemin/sortie sh e2e/banc/rendus/styles-video.sh          # rend les 3 démos puis extrait
#   DEMOS=/chemin/sortie SANS_RENDU=1 sh e2e/banc/rendus/styles-video.sh   # extrait seulement
#
# 1. Démo Créer « LE SPORT LE PLUS COMPLET » (9:16) rendue une fois par style, le style étant
#    CHOISI dans la galerie de l'étape Style (`DEMO_STYLE`, voir demo-creer.spec.ts). Polices servies
#    depuis les fichiers next/font du banc (`BANC_POLICES_LOCALES=1`) : sans elles le canvas du banc
#    dessine en police de repli. Aucun accès réseau externe.
# 2. Extrait muet ≈ 6 s, 270×480 : 0–2,2 s (apparition du titre) + 19,2–23 s (transition Cartes → Vidéo
#    puis premières coupes du montage). Poster = l'image à 1 s.
# Sorties : public/styles-video/<style>.mp4 + <style>.jpg (versionnés).
set -eu
ICI="$(cd "$(dirname "$0")" && pwd)"
RACINE="$(cd "$ICI/../../.." && pwd)"
: "${DEMOS:?DEMOS=dossier de sortie des démos}"
SORTIE="$RACINE/public/styles-video"
mkdir -p "$DEMOS" "$SORTIE"
for s in minimaliste sport cinematique; do
  if [ -z "${SANS_RENDU:-}" ]; then
    (cd "$RACINE" && BANC_POLICES_LOCALES=1 DEMO_STYLE="$s" DEMO_SORTIE="$DEMOS" BANC_PORT="${BANC_PORT:-4100}" \
      npx playwright test -c e2e/banc/playwright.banc.config.ts e2e/banc/demo-creer.spec.ts --project ordinateur)
  fi
  W="$DEMOS/creer-sport-style-$s.webm"
  ffmpeg -nostdin -v error -y -i "$W" -filter_complex \
    "[0:v]trim=0:2.2,setpts=PTS-STARTPTS[a];[0:v]trim=19.2:23,setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1:a=0,fps=24,scale=270:480:flags=lanczos,format=yuv420p[v]" \
    -map "[v]" -an -c:v libx264 -preset slow -crf 30 -profile:v main -movflags +faststart "$SORTIE/$s.mp4"
  ffmpeg -nostdin -v error -y -ss 1 -i "$W" -frames:v 1 -vf "scale=270:480:flags=lanczos" -q:v 5 "$SORTIE/$s.jpg"
done
ls -l "$SORTIE"
