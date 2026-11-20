#!/usr/bin/env bash
# prep.sh — split Tomás R.'s take, trim dead air, shorten pauses >0.8 s, high-pass 80 Hz, loudnorm −16 LUFS (+ exact-gain second pass),
# then cut the off-script asides Tomás R. recorded at the head of his files (found by ear-check, 20 nov):
#   s09 "Ya, toma, voy. Ahí." · s10 "Y ahora vamos a escena 10, ahí está," · s11 "Escena 11." · s12 "La parte mía."
set -e; export LC_ALL=C
SRC=/mnt/SSDGames/mtg-video/Script-Audio; V=/mnt/SSDGames/mtg-video/work/voces
OUT=/home/inzenfenix/Documents/GitHub/framework-ia-UDD/docs/presentation/video/film/assets/audio; mkdir -p "$OUT"
F="highpass=f=80,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15:stop_periods=-1:stop_duration=0.8:stop_threshold=-45dB:stop_silence=0.45,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.25,areverse,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000"
p() { local name=$1; shift; ffmpeg -v error -y "$@" -ac 1 -af "$F" -c:a pcm_s16le "$OUT/$name.wav"; }
p s01_solano -i "$SRC/S1.mp3"; p s02_solano -i "$SRC/S2.mp3"; p s03_solano -i "$SRC/S3.mp3"; p s04_solano -i "$SRC/S4.mp3"; p s12_solano -i "$SRC/S12-TS.mp3"
for n in 5 6 7 8; do p s0${n}_fuentes -i "$V/vicente/escena$n.mp3"; done; p s12_fuentes -i "$V/vicente/escena12.mp3"
p s09_rodriguez -ss 0 -to 66.55 -i "$V/tomasr.wav"; p s10_rodriguez -ss 66.6 -to 118.95 -i "$V/tomasr.wav"
p s11_rodriguez -ss 123.75 -to 189.6 -i "$V/tomasr.wav"; p s12_rodriguez -ss 195.25 -to 210.15 -i "$V/tomasr.wav"
# head trims (seconds into the processed file, each just before the first scripted word), 30 ms fade-in
head() { ffmpeg -v error -y -ss "$2" -i "$OUT/$1.wav" -af afade=t=in:d=0.03 -c:a pcm_s16le "$OUT/$1.tmp.wav" && mv "$OUT/$1.tmp.wav" "$OUT/$1.wav"; }
head s09_rodriguez 4.45; head s10_rodriguez 5.25; head s11_rodriguez 2.1; head s12_rodriguez 1.65
# second pass: single-pass loudnorm undershoots (~ -19 LUFS on these files) — measure, apply the exact gain, limit peaks
cd "$OUT"; for f in *.wav; do
  l=$(ffmpeg -nostats -i "$f" -af ebur128 -f null - 2>&1 | grep -E '^\s+I:' | tail -1 | awk '{print $2}')
  ffmpeg -v error -y -i "$f" -af "volume=$(python3 -c "print(round(-16-($l),2))")dB,alimiter=limit=0.84:level=disabled" -c:a pcm_s16le "tmp_$f" && mv "tmp_$f" "$f"
done
for f in *.wav; do printf '%-20s %6.2f\n' "$f" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")"; done
