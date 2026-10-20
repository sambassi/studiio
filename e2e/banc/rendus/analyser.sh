#!/bin/sh
# Mesures d'un MP4 de démo : ffprobe, planche-contact (fps 2/3, sans drawtext), coupes, gels, silences, loudness.
#   sh e2e/banc/rendus/analyser.sh fichier.mp4 [t1 t2 …]
#   → fichier.mesures.txt + fichier.planche.png (+ fichier.instants.png : une image par timecode demandé)
set -eu
F="$1"; B="${F%.*}"; shift
{
  echo "== ffprobe"; ffprobe -v error -show_entries format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels,duration -of compact "$F"
  echo "== coupes (scene>0.2)"; ffmpeg -nostdin -v info -i "$F" -vf "select='gt(scene,0.2)',showinfo" -an -f null - 2>&1 | grep -o 'pts_time:[0-9.]*' | tr '\n' ' '; echo
  echo "== gels (freezedetect n=0.003 d=0.5)"; ffmpeg -nostdin -v info -i "$F" -vf "freezedetect=n=0.003:d=0.5" -an -f null - 2>&1 | grep -o 'freeze_[a-z]*: [0-9.]*' | tr '\n' ' '; echo
  echo "== silences (-40 dB, 0.3 s)"; ffmpeg -nostdin -v info -i "$F" -af "silencedetect=n=-40dB:d=0.3" -vn -f null - 2>&1 | grep -o 'silence_[a-z]*: [0-9.]*' | tr '\n' ' '; echo
  echo "== ebur128"; ffmpeg -nostdin -v info -i "$F" -af ebur128=peak=true -vn -f null - 2>&1 | sed -n '/Summary/,$p' | grep -E 'I:|LRA:|Peak:'
} > "$B.mesures.txt" 2>&1
ffmpeg -nostdin -v error -y -i "$F" -vf "fps=2/3,scale=270:-2,tile=8x6:padding=4:color=black" -frames:v 1 "$B.planche.png"
if [ "$#" -gt 0 ]; then
  T="$(mktemp -d)"; n=0; ent=""
  for t in "$@"; do
    ffmpeg -nostdin -v error -y -ss "$t" -i "$F" -frames:v 1 -update 1 -vf scale=360:-2 "$T/$n.png" || true
    if [ -s "$T/$n.png" ]; then ent="$ent -i $T/$n.png"; n=$((n+1)); else echo "instant $t : aucune image (au-delà de la fin ?)" >> "$B.mesures.txt"; fi
  done
  if [ "$n" -gt 1 ]; then ffmpeg -nostdin -v error -y $ent -filter_complex "hstack=inputs=$n" "$B.instants.png"; else cp "$T/0.png" "$B.instants.png"; fi
  echo "instants : $*" >> "$B.mesures.txt"
fi
cat "$B.mesures.txt"
