#!/bin/sh
# Médias LOCAUX des démos (jamais versionnés), extraits des deux MP4 réels de l'utilisateur.
#   sh e2e/banc/rendus/preparer-demos.sh [MOTIVATION.mp4] [LE_SPORT.mp4]
# Prérequis : sh e2e/banc/preparer-medias.sh (rush-1..3, voix.mp3).
set -eu
M="${1:-$HOME/Downloads/MOTIVATION.mp4}"
S="${2:-$HOME/Downloads/LE_SPORT_LE_PLUS_COMPLET (2).mp4}"
D="$(cd "$(dirname "$0")/.." && pwd)/medias/demo"
mkdir -p "$D"
# Les deux MP4 sources sont des RENDUS : leurs anciens textes (titre, cartes, CTA, filigrane) sont incrustés.
# Pour ne pas les confondre avec les textes du nouveau rendu, chaque bande qui en portait est FLOUTÉE
# (bandes en fraction de hauteur : "y0:y1 y0:y1 …").
flou() { # flou entree sortie "bandes" [options ffmpeg avant -i]
  e="$1"; s="$2"; bandes="$3"; shift 3
  g="[0:v]null[v0]"; i=0
  for b in $bandes; do
    y0="${b%%:*}"; y1="${b##*:}"; j=$((i+1))
    g="$g;[v$i]split[p$i][q$i];[q$i]crop=iw:ih*($y1-$y0):0:ih*$y0,boxblur=24:6[m$i];[p$i][m$i]overlay=0:H*$y0[v$j]"
    i=$j
  done
  ffmpeg -nostdin -v error -y "$@" -i "$e" -filter_complex "$g" -map "[v$i]" -map '0:a?' $enc "$s"
}
enc="-c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -r 30 -c:a aac -b:a 128k -ar 48000 -ac 2 -movflags +faststart"
# Avatar « HeyGen » simulé : passages où l'avatar parle dans MOTIVATION.mp4, mis bout à bout
# (4,0–6,2 · 10,0–13,0 · 16,0–24,68 · 10,0–13,0 · 16,0–24,0) puis coupés à 24,68 s = durée de parole réelle.
ffmpeg -nostdin -v error -y -i "$M" -filter_complex "\
[0:v]trim=4.0:6.2,setpts=PTS-STARTPTS[v1];[0:a]atrim=4.0:6.2,asetpts=PTS-STARTPTS[a1];\
[0:v]trim=10.0:13.0,setpts=PTS-STARTPTS[v2];[0:a]atrim=10.0:13.0,asetpts=PTS-STARTPTS[a2];\
[0:v]trim=16.0:24.68,setpts=PTS-STARTPTS[v3];[0:a]atrim=16.0:24.68,asetpts=PTS-STARTPTS[a3];\
[0:v]trim=10.0:13.0,setpts=PTS-STARTPTS[v4];[0:a]atrim=10.0:13.0,asetpts=PTS-STARTPTS[a4];\
[0:v]trim=16.0:24.0,setpts=PTS-STARTPTS[v5];[0:a]atrim=16.0:24.0,asetpts=PTS-STARTPTS[a5];\
[v1][a1][v2][a2][v3][a3][v4][a4][v5][a5]concat=n=5:v=1:a=1[v][a]" -map "[v]" -map "[a]" -t 24.68 $enc "$D/avatar-motivation.mp4"
flou "$D/avatar-motivation.mp4" "$D/avatar-motivation-net.mp4" "0.6:0.98" && mv "$D/avatar-motivation-net.mp4" "$D/avatar-motivation.mp4"
# Trois médias « stock » (ceux du vrai montage) : écriture, salle de muscu (7,0–10,0 s, sans le plan d’avatar qui précède), torse N&B.
flou "$M" "$D/stock-ecriture.mp4" "0.0:0.22 0.9:0.98" -ss 0 -t 4.0
flou "$M" "$D/stock-muscu.mp4" "0.6:0.98" -ss 7.0 -t 3.0
flou "$M" "$D/stock-torse.mp4" "0.45:0.98" -ss 13.0 -t 3.0
# Trois rushes SPORT (9–13 s, 13–17 s, 21–26 s) et une affiche, bandes de cartes / filigrane floutées.
R="$(cd "$D/.." && pwd)"
flou "$S" "$R/demo-rush-1.mp4" "0.4:0.53 0.9:0.98" -ss 9 -t 4
flou "$S" "$R/demo-rush-2.mp4" "0.4:0.53 0.9:0.98" -ss 13 -t 4
flou "$S" "$R/demo-rush-3.mp4" "0.4:0.53 0.9:0.98" -ss 21 -t 5
ffmpeg -nostdin -v error -y -ss 2 -i "$S" -frames:v 1 -vf "crop=iw:ih*0.8:0:ih*0.2,scale=1080:1920" -q:v 3 "$R/demo-affiche.jpg"
# « Musique » simulée : la piste son de LE_SPORT 45–61 s (rushes sans texte = fond musical), 16 s.
ffmpeg -nostdin -v error -y -ss 45 -t 16 -i "$S" -vn -c:a libmp3lame -b:a 128k "$D/musique.mp3"
for f in "$D"/*; do printf '%s ' "$(basename "$f")"; ffprobe -v error -show_entries format=duration -of csv=p=0 "$f"; done
# Le banc sert /banc-medias/<fichier> depuis e2e/banc/medias : la musique y est aussi copiée.
cp "$D/musique.mp3" "$D/../musique.mp3"
# Voix-off par séquence (Créer) : de la PAROLE réelle (avatar), aux durées d'une vraie narration.
A="$D/avatar-motivation.mp4"
ffmpeg -nostdin -v error -y -ss 0 -t 6 -i "$A" -vn -c:a libmp3lame -b:a 128k "$R/demo-voix-titre.mp3"
ffmpeg -nostdin -v error -y -ss 6 -t 14 -i "$A" -vn -c:a libmp3lame -b:a 128k "$R/demo-voix-cartes.mp3"
ffmpeg -nostdin -v error -y -ss 9 -t 12 -i "$A" -vn -c:a libmp3lame -b:a 128k "$R/demo-voix-video.mp3"
ffmpeg -nostdin -v error -y -ss 20 -t 4.5 -i "$A" -vn -c:a libmp3lame -b:a 128k "$R/demo-voix-cta.mp3"
