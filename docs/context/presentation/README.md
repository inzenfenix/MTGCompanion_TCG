# Presentation video (Examen Parte 1) — state and how to continue

Dated **18 nov 2026**. ROADMAP.md row **O18** (🚧, issue #152). Source of truth for the content is
[`docs/presentation/video/GUION.md`](../../presentation/video/GUION.md) (script, Spanish, ~13 min, three
speakers); this file is the working state for whoever continues the build.

## What exists

| Piece | Where | State |
|---|---|---|
| Script + recording list | `docs/presentation/video/GUION.md` | done; scene 2 and 5 adjusted to what was recorded |
| Storylines | `docs/presentation/video/STORYLINES.md` | user picked a **mix**: A (Marta's data is the thread) + B (each control is "played" as an original card) + C (system map as home stage) |
| Film spec | `docs/presentation/video/film/SPEC.md` | look, motion, banned list |
| HyperFrames project | `docs/presentation/video/film/` | `index.html` mounts all 13 scenes in order (`0–841 s`, 14:01): `s00` (0–8), `s01` (8–45), `s02` (45–111), `s03` (111–173), `s04` (173–253), `s05` (253–306), `s06` (306–375), `s07` (375–446), `s08` (446–514), `s09` (514–612), `s10` (612–695), `s11` (695–791), `s12` (791–841) |
| Draft render | `film/renders/borrador_s00_s03.mp4`, `borrador_s04_s06.mp4`, `borrador_s07.mp4` … `borrador_s12.mp4` (gitignored) | all 13 scenes (841 s total), each checked frame by frame |
| Real clips | `docs/presentation/video/assets/clips/*.mp4` (gitignored, ~40 MB) | all recorded — list below |
| Demo tooling | `docs/presentation/video/demo/` | committed; reproduces every clip |

Recorded clips: `s02a_bazar_compra`, `s02b_qr_vendedor` (app), `s04_cifrado`, `s05_minimizacion`,
`s06_seudonimos`, `s07_rbac` (terminal), `s08_consentimiento` (app) + `s08b_bd`, `s09_derechos` (app) +
`s09b_exportacion_correos`, `s10a_formulario_publico`, `s10b_oposicion_bloqueo` (app) + `s10_oposicion_bloqueo`
(terminal), `s11a_incidente`, `s11b_reconstruccion`, `s11c_cadena` (terminal). Terminal clips appear in the film
only inside the **evidence monitor** (user's call: "keep the monitor"); the explanation itself is animated.

## Still to build (in order)

1. ~~Scenes **0–3**~~ — all done 18 nov (`s00` 8 s, `s01` 37 s, `s02` 66 s, `s03` 62 s).
2. ~~Scenes **4–12**~~ — all done 18 nov (`s04`–`s12`, total film 841 s = 14:01).
3. ~~Audio~~ — done 19 nov (see "Audio" below): voices split/normalized, every scene retimed to its narration,
   music bed + card whooshes mounted. Film = **880.2 s (14:40)**.
4. Final render: `hf render --quality delivery -o /mnt/SSDGames/mtg-video/renders/mtg_companion_examen_parte1.mp4`
   (19 nov) — **done**: 880.2 s, 1920×1080 30 fps, −16.0 LUFS integrated, peak −2.9 dBFS; four cue words checked
   on the render's own transcript land 0–0.8 s after their beat. O18 ✅.

## Audio (19 nov)

- **Sources** (outside the repo, personal data): `/mnt/SSDGames/mtg-video/Script-Audio/` — `S1–S4.mp3` +
  `S12-TS.mp3` (Solano), `Scenes Vicente.zip` (`escena5–8`, `escena12`), `Scenes-TomasR.mp4` (Rodríguez, scenes 9–12
  in one take; cut at 0–66.55 / 66.6–118.95 / 123.75–189.6 / 195.25–210.15 s, dropping the spoken "Y escena 12, la
  parte mía" and the trailing "a casa, a casa"). **20 nov fix (team feedback):** his files still opened with
  off-script asides that played in the film — s09 "Ya, toma, voy. Ahí.", s10 "Y ahora vamos a escena 10, ahí está,",
  s11 "Escena 11.", s12 "La parte mía." — `prep.sh` now head-trims them (4.45 / 5.25 / 2.1 / 1.65 s into the
  processed file, each checked by transcribing what's left).
- `demo/audio/prep.sh` → `film/assets/audio/sNN_<apellido>.wav` (gitignored): high-pass 80 Hz, dead air trimmed,
  pauses > 0.8 s shortened, then gain-matched to −16 LUFS ±0.3 (single-pass loudnorm undershot to −19 on short
  files; that second pass — measure, exact `volume` gain, `alimiter` — was done by hand on 19 nov and is in
  `prep.sh` since 20 nov, after a rerun without it came out 2.8 dB quieter). Speaking time: Solano 3:50, Fuentes 4:00, Rodríguez 2:57.
- Word timestamps: `hf transcribe <wav> -e whisper -m small -l es` (local whisper.cpp; transcripts in
  `/mnt/SSDGames/mtg-video/work/voces/tr/`).
- `demo/audio/retime.py` (log: `retime_20nov.log`): each beat lands 0.3 s before its spoken cue; the voice pauses at
  a real silence while a silent evidence monitor plays (silent monitors at 80 % length, trimmed from the start so
  the payoff stays) or while a beat still needs reading time (last element's offset + 0.5 s + 0.3 s/word); writes
  the voice as `<audio id="sNN-voz-N">` (lane 6, `data-volume="0.75"` — the render plays mono voice dual-mono,
  +3 dB) inside each scene and restacks `index.html`. **Not idempotent** — see its docstring.
  **Pause points (20 nov fix):** the 19 nov version cut where whisper *said* a word started (or `t − 0.12` when
  silencedetect found no 0.12 s gap), which split words ("para", "jugadores") and phrases ("así que dado esto, |
  le paso la palabra") — heard at 4:15, 8:00, 10:20 — and left a 0.07 s scrap of "¿Qué" at the top of s12. Now the
  gaps come from the waveform (20 ms RMS < −45 dBFS for ≥ 60 ms, on the −16 LUFS files), the cut takes the best gap from 2.5 s before to
  0.6 s after the cue (longer, after a `.`/`?`/`!` (or `,`), closer), never within 0.4 s of a segment start, and the
  log prints the words either side of every cut. To audit: transcribe 3 s each side of every split (all 29 read
  as sentence/clause ends on 20 nov). The s04 handoff is pinned (`CUT_AFTER`: pause right after "secreto") —
  the scoring flipped between "secreto. |" and "así que, dado esto, |" with a 3 dB level change. s08's `pur` cue moved to "cada finalidad: ubicación…" so the art. 12 list
  isn't split by a pause.
- `demo/audio/mix.py` (idempotent, run after `retime.py`) writes the music lane and the effects into `index.html`.
- Music: `#musica` in `index.html` (lane 7), HeyGen catalog track `78f194ec` ("soft fantasy ambient strings"),
  looped with 3 s crossfades to 884 s by `demo/audio/bed.sh` (`fetch.mjs`/`search.mjs` re-download it; needs
  `hf auth login`); `film/assets/bgm/` is gitignored. Volume lane: 0.55 intro, 0.14 under voice, 0.26 in silent
  stretches > 2.5 s, 0.5 under the closing card. Chosen by measurement (few transients, LRA 6.8), not by ear.
- Effects: `film/assets/sfx/` (Pixabay Content License, no attribution required): one whoosh per card drop,
  two takes alternated, lane 8.

## Conventions used in every scene (keep them)

- One sub-composition per scene, ids prefixed `sNN-`, scene root `#root`, `fromTo` only, timeline registered as
  `window.__timelines['sNN']`. Ground = `assets/media/pano.jpg` (the red cloth from the team's scanner photos).
- **`T` table** at the top of each scene script holds every segment start; the matching `data-start` values in the
  HTML use the same numbers. Retiming to the real voice = edit `T` + those `data-start`s.
- The **card** (560×784, gold border, Cinzel) lands and flips, then retires to the left (`x:-560, scale:.62`); content
  lives in x 760–1840. Legal article on the gold "cost" strip. Red `#ff5a4f` only for what fails/rejects.
- **Evidence monitor**: gold-framed box with a muted `<video class="clip">` (timed itself, `data-media-start` for
  the segment) and the caption "Grabación real · backend local, datos de prueba". The monitor wrapper is untimed and
  animated with opacity only.
- Values on screen are the **real ones** from the recordings (hashes, `v1:…`, `u_…`, status codes). Never show a
  password, key or full token.
- Copy each clip a scene uses into `film/assets/media/` (gitignored `*.mp4`).
- App clips are portrait (824×1830): s08 shows them in a **phone monitor** (`#s08-pmon`, 640×960) whose inner
  `.crop` (with `data-layout-allow-overflow`) shows the top ~1170 px of the screen; the `<video>` itself stays
  untransformed.
- Real values for scene 8 came from the demo DB (still running in Docker: `mtg-companion-dev-postgres-1`); query
  it with `docker exec … psql` when a scene needs a value the clip doesn't show legibly.
- After any edit: `hf check --json` (fix every error), `hf snapshot --at …` and look, then render. `check --json`
  prints progress before the JSON; read the saved report at `film/.hyperframes/artifacts/checks/<newest>.json`.
  Render one scene with `hf render --quality draft --start <a> --end <b> -o renders/borrador_sNN.mp4`.

## Environment (this machine)

- Run the HyperFrames CLI via the plugin launcher: `/mnt/SSDGames/mtg-video/tools/hf <command>` (wrapper around
  `node ~/.claude/plugins/marketplaces/hyperframes/skills/hyperframes/scripts/plugin-cli.mjs`). Skills to read:
  `~/.claude/plugins/marketplaces/hyperframes/skills/hyperframes/SKILL.md` (+ `references/format.md`, `motion.md`).
- Heavy work dir: `/mnt/SSDGames/mtg-video/` (`tools/`: vhs, ttyd, gitleaks, hf, sheet.sh; `work/`: demo state,
  downloads, frames; `backend.log`). The main drive has little free space.
- App stack for re-recording: `apps/backend/.env` (gitignored, random dev keys), Postgres + MailHog from
  `apps/backend/docker/docker-compose.yml`; **MinIO's Docker Hub image is gone** — run it with a local override
  using `cgr.dev/chainguard/minio` (healthcheck disabled) and create the bucket with
  `cgr.dev/chainguard/minio-client`. Then `prisma migrate deploy`, `npm run db:seed`, `npm run db:import-catalog --
  --file Proyecto/certamen_1/data/cards.json`, `node docs/presentation/video/demo/prepare.mjs /mnt/SSDGames/mtg-video/work`,
  `node docs/presentation/video/demo/listings.mjs Proyecto/certamen_1/data/real_photos`. Backend: `node dist/main.js`;
  app: `VITE_API_BASE_URL=http://localhost:3000 npx vite --port 5173` in `apps/mobile` (after `npm run setup:opencv`
  and `setup:tesseract`).
- Demo password for every `@example.com` account: `DemoMTG-2026!` (dev only). Eva has 2FA (secret in
  `work/eva.totp`, outside the repo).

## Gotchas found while recording

- The demo DB is **not pristine**: scene 11c deliberately broke the audit hash chain (seq 238); marta/dani/valentina/
  mateo/renata carry state from their takes. Re-recording scenes 6 or 11 needs a fresh DB (re-run the steps above).
- VHS silently drops `→` in typed text; access tokens expire after 15 min (`lib.sh` clears its cache per take).
- Ionic alerts reuse the previous input value — `scenes.mjs` clears the field before typing.
- A wrong password in the app's step-up dialog logs the user out (any 401 ends the session) — app bug, not fixed.
- Bazar list thumbnails stay blank although the detail page shows the photo — app bug, not fixed.
- The headless scanner (fake camera) misidentifies cards; scene 2 uses an animated scanner instead.
- Only Stage 1 (TF) and Stage 4 (PyTorch combined) ONNX models exist in `apps/mobile/public/models/` (exported
  18 nov from `Proyecto/` checkpoints); Stage 2/3 were never trained in this checkout.
- `dry` runs of `scenes.mjs` perform the real actions (purchases, requests) — use a spare account.

## Prompt for the next session

> Continue ROADMAP O18 (presentation video) — **audio integration, retiming, and final delivery render**.
>
> First read `docs/context/presentation/README.md`, `docs/presentation/video/GUION.md`, `docs/presentation/video/film/SPEC.md`, and the HyperFrames skill at `~/.claude/plugins/marketplaces/hyperframes/skills/hyperframes/SKILL.md` (+ `references/format.md`, `references/sound.md`, `references/review.md`). Use `/mnt/SSDGames/mtg-video/tools/hf` for HyperFrames CLI commands and `/mnt/SSDGames/mtg-video/work/chk.sh sNN` to check individual scenes.
>
> All 13 visual scenes (`compositions/s00.html` through `s12.html`, currently 841 s = 14:01) are built and mounted in order in `docs/presentation/video/film/index.html`. The team's voice recordings are now ready in `docs/presentation/video/assets/audio/` (`s01_solano`–`s04_solano`, `s05_fuentes`–`s08_fuentes`, `s09_rodriguez`–`s11_rodriguez`, and `s12_fuentes`/`s12_solano`/`s12_rodriguez`, WAV or M4A).
>
> Do the following step by step:
> 1. **Inspect and normalize voices**: probe each voice file's duration with `ffprobe`, trim leading/trailing dead air and normalize loudness (e.g., EBU R128 `-16 LUFS`, gentle high-pass/denoise if needed) into `docs/presentation/video/film/assets/audio/` (gitignored). Report per-speaker speaking time (Tomás Solano, Vicente Fuentes, Tomás Rodríguez) and total duration to confirm it stays inside the 10–15 min rubric and stays balanced across the three speakers.
> 2. **Retime scenes to the real narration**: for each scene `s01`–`s12`, listen/inspect speech timestamps (e.g., via silence/transcript alignment) and adjust that scene's `T` table + matching `data-start`/`data-duration` attributes (including `#sNN-pano` and `#sNN-card-clip` full durations) so every visual beat and evidence monitor lands right on the spoken cue. Keep `s00` (8 s, music only) at the start, then update every scene's `data-start`/`data-duration` and the root `data-duration` in `film/index.html`.
> 3. **Mount audio, music bed, and SFX** (per `references/sound.md` and `references/format.md`):
>    - Give every `<audio>` clip a stable `id`, `class="clip"`, `data-start`, `data-duration`, and dedicated lanes (`data-track-index` — one lane for voice, one for music bed, one for subtle SFX).
>    - Add a quiet, copyright-free ambient music bed (no rigid beat, per `SPEC.md`), ducked gently under speech with `data-fade-in`/`data-fade-out` and `data-automation` volume envelopes, louder only on `s00` intro and `s12` closing card.
>    - Add subtle, restrained SFX on key card flips/landings and error stamps (never distracting from narration).
> 4. **Verify and review**: run `hf check --json` (fix all errors and check `line_unread`/audio warnings), run `hf snapshot --review` (or key-frame snapshots around retimed seams), and render a draft check first if needed.
> 5. **Final delivery render**: run `/mnt/SSDGames/mtg-video/tools/hf render docs/presentation/video/film --quality delivery -o /mnt/SSDGames/mtg-video/renders/mtg_companion_examen_parte1.mp4` (keep large output on `/mnt/SSDGames/mtg-video/` since the main drive has limited free space), verify audio/video sync, length (10–15 min), and loudness, update `docs/context/presentation/README.md`, mark ROADMAP **O18** ✅, commit, and push.
