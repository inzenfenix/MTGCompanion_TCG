# Environment — dev machine specifics affecting `apps/`

Canonical source: root `CLAUDE.md`'s "Environment notes" section — this is
a condensed, `apps/`-focused pointer to it, not a replacement. These are
**one dev machine's** specifics, not universal — don't bake any of these
into a default that would break on a different setup (see root `CLAUDE.md`
hard rule 1).

- **AMD GPU via ROCm**, `HSA_OVERRIDE_GFX_VERSION=10.3.0` needed for PyTorch
  on this card (mobile RDNA2) — `desktop-runner`'s GPU detection already
  handles this automatically. Affects anyone re-training a model through
  `desktop-runner` on this machine.
- **`tesseract` (system OCR binary) is installed** (`tesseract 5.5.2`) —
  needed by `ml/data-prep`'s Python OCR pipeline (`prepare_text_validator_dataset.py`).
  This is unrelated to the client's in-browser OCR (`tesseract.js`, see
  `docs/context/tools/README.md`) — don't confuse the two when debugging an OCR
  issue; check which side (Python dataset prep vs. browser inference) is
  actually failing first.
- **TensorFlow has no GPU path on AMD outside Docker** — no maintained ROCm
  wheel for `tensorflow>=2.16`. `desktop-runner` falls TensorFlow back to
  CPU cleanly on AMD, no flag needed. The real fix (a `rocm/tensorflow`
  Docker image) is ROADMAP.md workstream D — don't try to patch this with a
  pip flag.
- **Android APK build** (`apps/mobile/`, Capacitor) needs, at the
  system level (not npm packages): **JDK 17–21** (AGP 8.13.0/Gradle 8.14.3
  don't support newer JDKs) and the **Android SDK** (cmdline-tools +
  `platform-tools` + `platforms;android-36` + `build-tools;36.0.0`). Both
  can be installed user-local without sudo (portable JDK from Eclipse
  Temurin; `sdkmanager` into any user folder) — full steps in root
  `README.md`'s "Requisitos del sistema" section. Release signing
  (keystore + `signingConfigs`) is tracked separately — ROADMAP.md item E3d.
- **Terraform + AWS CLI** are user-local installs too, same no-sudo
  rationale — see `docs/context/infra/README.md`.

### Second checkout: Windows 11 (noted 23 oct, O14)

The user also works from a Windows checkout (OneDrive path) with **no
Docker, no Postgres, no `python`, no `terraform`, no poppler**; Node 24 +
npm 11 (blocks dependency install scripts by default) and Edge are there.
Working-tree files are CRLF (`* text=auto`).

- Backend e2e: `npm run test:e2e:embedded` (throwaway PostgreSQL 16 from the
  `embedded-postgres` dev dependency; random keys per run). It also runs the
  destructive suites (anonymizer, DB-role creation) that `npm run test:e2e`
  skips on the shared Docker dev DB. `catalog.e2e-spec` fails there only
  because `ml/training/data/cards.json` (gitignored) isn't on that box.
- Mobile unit tests: `stage1Detector.test.ts` needs
  `public/models/stage1-detector.onnx` (gitignored, absent there).
- Markdown → PDF: Edge headless `--print-to-pdf` (how `ACTIVIDAD_4.pdf` was built).
