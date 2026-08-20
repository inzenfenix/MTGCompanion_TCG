# Session plan — 2026-08-20

Summary of what this session did, plus the concrete steps still needed
from a human (repo-admin / `gh` access) to actually finish standing up
the M2 CI pipeline.

## 1. I31 — Stage 1 "generic scenes" negative class, full Optuna + n=3000 retrain (PyTorch)

- Reinstalled CUDA-enabled `torch`/`torchvision` (cu126) in `pytorch/.venv`
  — this machine has an NVIDIA RTX 2050, unlike the CPU-only machines
  earlier partial I31 runs used.
- Found and fixed two real bugs in the negative-source downloader
  (`pytorch/07_binary_classifier.py`) that were crashing the run on
  transient Wikimedia Commons 429s:
  1. Fixed-size sources (the 52/40-card playing-card decks) were compared
     against the *global* `n_target` instead of their own size, so every
     run pointlessly re-hit the Commons API to "expand" an already-complete
     deck.
  2. `obtener_metadata_generic_scenes()`'s URL-resolve call had no
     try/except guard (unlike its category-listing call), so a persistent
     429 there crashed the whole multi-hour run instead of skipping that
     category.
- Cleaned up a real mess from an earlier launch bug: two duplicate Optuna
  processes ended up training concurrently on the same GPU for ~3 hours,
  writing to the same log file. Killed the less-advanced one (6/20
  trials), kept the further-along one (19/20).
- **Result**: the Optuna sweep (20 trials) completed; the final 15-epoch
  retrain was still running as of this writing. Remaining once it lands:
  held-out verification (same method I31's prior partial runs used),
  ONNX export, republish to Ionic, and a real ROADMAP.md I31 update with
  the numbers.
- TensorFlow's half of this retrain was **not** started this session
  (native-Windows TF≥2.11 has no GPU path here at all) — another session
  already ported the same 429-crash fix to the TensorFlow copy of the
  script (commit `08d5ef1`), so it's ready to run whenever someone picks
  it up.

## 2. Trading-camera parity fix (buyer/seller cameras vs. the add-card camera)

User-reported: the Trade Nexus (buyer + seller) cameras worked much worse
than the "add card" (`ListCard.tsx`) camera.

- Root cause: `Tab2.tsx` never got the `useIonViewWillEnter`/
  `useIonViewWillLeave` lifecycle fix `ListCard.tsx`'s Smart Scan camera
  already has, even though both share the exact same
  `useLiveCamera`/`GuidedCapture` stack. Since `IonRouterOutlet` keeps
  pages mounted, leaving Tab2 left the camera streaming in the background
  indefinitely, and returning resumed with stale role/step/QR/transaction
  state instead of a fresh screen.
- Fixed: ported the same lifecycle pattern — camera stops on leaving,
  state resets on real re-entry.
- Also gave the buyer's `QrScanner` a switch-camera button, matching the
  one `GuidedCapture` already has (multi-lens phones can default to the
  wrong lens — same class of issue as ROADMAP.md I16).
- Verified: `tsc --noEmit`, `eslint`, `vite build` clean; `vitest`
  96/97 (the 1 failure is a pre-existing, unrelated gap — a missing
  `stage1-detector.onnx` on this checkout, not touched by this change).
  Not verified: an actual live/on-device click-through (no browser/device
  connected this session).
- Pushed as `310e893`.

## 3. M2 — GitHub Actions workflow to build the APK from M1's S3 models

New `.github/workflows/build-apk.yml` (manual `workflow_dispatch`):
checkout → `npm ci` → pull M1's exported `.onnx` models from S3 → write
`.env`/`network_security_config.xml` from the deployed `backend_url` →
the same `setup:opencv` → `build` → `cap sync android` →
`gradlew assembleDebug` sequence `desktop-runner`'s local "Reconstruir
APK" button already runs → publish `app-debug.apk` as a GitHub Release.

Documented in `Proyecto/examen/trading-app-ionic/README.md`'s new "CI:
compilar el APK..." section. Verified: YAML parses; the `.env`/XML
substitution logic was dry-run tested against the real committed file.
**Not verified**: no live GitHub Actions run — this machine has no `gh`
CLI or GitHub token, so the pipeline has never actually been dispatched.

### What's still needed to make this pipeline actually run (human action items)

1. **Set 3 repo Secrets** (GitHub → repo → Settings → Secrets and
   variables → Actions → *Secrets*):
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `AWS_SESSION_TOKEN`

   These are the AWS Academy Learner Lab temp credentials — the same ones
   already pasted into `desktop-runner`'s Deploy tab. **They expire** — if
   a run later fails on the S3-sync step with an auth error, re-paste
   fresh ones here first.

2. **Set 3 repo Variables** (same Settings page, *Variables* tab):
   - `AWS_REGION` — `terraform output aws_region`
   - `DEPLOY_ARTIFACTS_BUCKET` — `terraform output
     deploy_artifacts_bucket_name`
   - `BACKEND_URL` — `terraform output backend_url` (can be overridden
     per-run via the workflow's own `backend_url` input instead of
     changing this)

3. **Make sure M1 has actually run recently** — `desktop-runner`'s Deploy
   tab → "Publicar modelos (S3)" — so `s3://…/models/` has the current
   `.onnx` files before dispatching. The workflow assumes they're already
   there; it doesn't train or export anything itself.

4. **Dispatch it**: GitHub → Actions tab → "Build Android APK (debug)" →
   Run workflow.

5. On success, the debug APK lands as a new GitHub Release
   (`apk-<run number>`, marked prerelease since it's debug-only — no
   release keystore exists yet).

## Open items / next steps

- Finish I31: verify the PyTorch retrain once it completes, export ONNX,
  republish to Ionic, write up real numbers in ROADMAP.md; decide whether
  to also run TensorFlow's now-fixed retrain.
- M3 (a `desktop-runner` button to trigger M2) stays blocked on `gh` CLI
  support + a credential-refresh design — not attempted this session.
- Release signing for the APK is still not set up (everything ships
  debug-signed for now, matching workstream C's own still-open note).
