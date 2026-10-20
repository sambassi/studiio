#!/bin/sh
# Extrait les médias LOCAUX du banc (jamais versionnés) depuis deux vidéos réelles, en lecture seule.
#   sh e2e/banc/preparer-medias.sh [MOTIVATION.mp4] [LE_SPORT.mp4]
set -eu
M="${1:-$HOME/Downloads/MOTIVATION.mp4}"
S="${2:-$HOME/Downloads/LE_SPORT_LE_PLUS_COMPLET (2).mp4}"
D="$(dirname "$0")/medias"
mkdir -p "$D"
cut() { ffmpeg -nostdin -v error -y -ss "$2" -t "$3" -i "$1" -c:v libx264 -preset veryfast -crf 28 -c:a aac -b:a 96k -movflags +faststart "$4"; }
cut "$M" 4 3 "$D/avatar.mp4"; cut "$M" 0 4 "$D/stock-1.mp4"; cut "$M" 6 4 "$D/stock-2.mp4"
cut "$S" 9 4 "$D/rush-1.mp4"; cut "$S" 13 4 "$D/rush-2.mp4"; cut "$S" 21 5 "$D/rush-3.mp4"
ffmpeg -nostdin -v error -y -ss 1 -i "$M" -frames:v 1 -q:v 4 "$D/image-1.jpg"
ffmpeg -nostdin -v error -y -ss 15 -i "$S" -frames:v 1 -q:v 4 "$D/image-2.jpg"
ffmpeg -nostdin -v error -y -ss 5 -i "$M" -frames:v 1 -vf scale=320:-2 -q:v 5 "$D/vignette-avatar.jpg"
ffmpeg -nostdin -v error -y -ss 4 -t 3 -i "$M" -vn -c:a libmp3lame -b:a 96k "$D/voix.mp3"
ls -la "$D"
