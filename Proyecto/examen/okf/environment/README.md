# Environment — dev machine specifics affecting `examen/`

Canonical source: root `CLAUDE.md`'s "Environment notes" section — this is
a condensed, `examen/`-focused pointer to it, not a replacement. These are
**one dev machine's** specifics, not universal — don't bake any of these
into a default that would break on a different setup (see root `CLAUDE.md`
hard rule 1).

- **AMD GPU via ROCm**, `HSA_OVERRIDE_GFX_VERSION=10.3.0` needed for PyTorch
  on this card (mobile RDNA2) — `desktop-runner`'s GPU detection already
  handles this automatically. Affects anyone re-training a model through
  `desktop-runner` on this machine.
- **`tesseract` (system OCR binary) is installed** (`tesseract 5.5.2`) —
  needed by `certamen_2`'s Python OCR pipeline (`prepare_text_validator_dataset.py`).
  This is unrelated to the client's in-browser OCR (`tesseract.js`, see
  `okf/tools/README.md`) — don't confuse the two when debugging an OCR
  issue; check which side (Python dataset prep vs. browser inference) is
  actually failing first.
- **TensorFlow has no GPU path on AMD outside Docker** — no maintained ROCm
  wheel for `tensorflow>=2.16`. `desktop-runner` falls TensorFlow back to
  CPU cleanly on AMD, no flag needed. The real fix (a `rocm/tensorflow`
  Docker image) is ROADMAP.md workstream D — don't try to patch this with a
  pip flag.
- **Android APK build** (`trading-app-ionic/`, Capacitor) needs, at the
  system level (not npm packages): **JDK 17–21** (AGP 8.13.0/Gradle 8.14.3
  don't support newer JDKs) and the **Android SDK** (cmdline-tools +
  `platform-tools` + `platforms;android-36` + `build-tools;36.0.0`). Both
  can be installed user-local without sudo (portable JDK from Eclipse
  Temurin; `sdkmanager` into any user folder) — full steps in root
  `README.md`'s "Requisitos del sistema" section. Release signing
  (keystore + `signingConfigs`) is tracked separately — ROADMAP.md item E3d.
- **Terraform + AWS CLI** are user-local installs too, same no-sudo
  rationale — see `okf/infra/README.md`.
