#!/usr/bin/env bash
# bed.sh — loop the chosen HeyGen catalog track (78f194ec, fetched with fetch.mjs) into a 884 s bed, −16 LUFS
set -e; export LC_ALL=C; cd "$(dirname "$0")"
N=12; args=(); fc=""; prev="[0:a]"
for i in $(seq 0 $((N-1))); do args+=(-i 78f194ec.mp3); done
for i in $(seq 1 $((N-1))); do fc+="${prev}[$i:a]acrossfade=d=3:c1=tri:c2=tri[x$i];"; prev="[x$i]"; done
ffmpeg -v error -y "${args[@]}" -filter_complex "${fc}${prev}atrim=0:884,afade=t=out:st=880:d=4,loudnorm=I=-16:TP=-1.5:LRA=11[o]" -map "[o]" -ar 48000 -c:a aac -b:a 160k bed.m4a
ffprobe -v error -show_entries format=duration -of csv=p=0 bed.m4a
