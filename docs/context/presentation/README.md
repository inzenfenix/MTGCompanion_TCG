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
| HyperFrames project | `docs/presentation/video/film/` | `index.html` mounts `compositions/s04.html` (0–80 s), `s05.html` (80–133 s), `s06.html` (133–202 s), `s07.html` (202–273 s) |
| Draft render | `film/renders/borrador_s04_s06.mp4`, `borrador_s07.mp4` (gitignored) | scenes 4–6 (202 s) and 7 (71 s, `--start 202 --end 273`), checked frame by frame |
| Real clips | `docs/presentation/video/assets/clips/*.mp4` (gitignored, ~40 MB) | all recorded — list below |
| Demo tooling | `docs/presentation/video/demo/` | committed; reproduces every clip |

Recorded clips: `s02a_bazar_compra`, `s02b_qr_vendedor` (app), `s04_cifrado`, `s05_minimizacion`,
`s06_seudonimos`, `s07_rbac` (terminal), `s08_consentimiento` (app) + `s08b_bd`, `s09_derechos` (app) +
`s09b_exportacion_correos`, `s10a_formulario_publico`, `s10b_oposicion_bloqueo` (app) + `s10_oposicion_bloqueo`
(terminal), `s11a_incidente`, `s11b_reconstruccion`, `s11c_cadena` (terminal). Terminal clips appear in the film
only inside the **evidence monitor** (user's call: "keep the monitor"); the explanation itself is animated.

## Still to build (in order)

1. Scenes **0–3** (intro, opening with the three names, the case — animated 4-step scanner + `s02a`/`s02b` + system
   map, Hito 1 flows map). Scene 0–1 must show each member's name; **every member identifies themself at the start
   of their block** (pauta).
2. Scenes **8–12** (7 RBAC done 18 nov): 8 consent, 9 rights, 10 public channel + objection +
   blocking, 11 traceability + incident, 12 closing (each member names one pending item).
3. Audio: the team records one file per scene (`GUION.md` → "Voces"), then retime each scene from its `T` table and
   add a quiet free music bed + small SFX (`hyperframes` skill → `references/sound.md`).
4. Final render (`hf render --quality delivery`), check length 10–15 min and per-speaker balance, then mark O18 ✅.

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

> Continue ROADMAP O18 (presentation video). Read `docs/context/presentation/README.md` first, then
> `docs/presentation/video/GUION.md` and `docs/presentation/video/film/SPEC.md`, and the HyperFrames skill at
> `~/.claude/plugins/marketplaces/hyperframes/skills/hyperframes/SKILL.md` (+ `references/format.md`,
> `references/motion.md`). Look at `film/compositions/s06.html` and `s07.html` as the pattern. Build the next
> scene (scene 8 — Actividad 5 consentimiento, Vicente) as `compositions/s08.html` following the conventions in the
> README (card, `T` table, evidence monitor with `assets/clips/s08_consentimiento.mp4` + `s08b_bd.mp4`, real values
> only — three purposes with text and version, revoke location, history, `lastLat`/`lastLng` → NULL, 403 on resend),
> mount it after s07 (start 273) in `index.html`, run `hf check --json`, snapshot, render a draft (`--start 273`),
> commit and push. Keep going scene by scene (9, 10, 11, 12, then 0–3) and update this README's "Still to build".
