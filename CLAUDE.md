# CLAUDE.md — Project memory

Course project for Fundamentos/Framework de IA (UDD). Two linked deliverables
living in the same repo:

- **`Proyecto/certamen_1/` + `Proyecto/certamen_2/`** — the ML coursework
  itself: an MTG card scanner pipeline, every stage trained **twice**, once
  in PyTorch and once in TensorFlow, so the two frameworks can be compared
  head-to-head on the same data/metrics and the better one picked per stage.
- **`Proyecto/examen/`** — "MTG Companion", a commercial app built on top of
  that pipeline: `trading-app-ionic/` (Ionic+React frontend, does on-device
  ONNX inference), `backend/` (NestJS + Prisma + Postgres marketplace API),
  `desktop-runner/` (Electron+NestJS+React app that is the GUI for running
  every training/export script in certamen_1/2 — venv management, live logs,
  Optuna, ONNX export, cross-framework comparison).

For the full task backlog (what's left, by workstream, with priority and
complexity so multiple people can grab different pieces in parallel), see
**[ROADMAP.md](ROADMAP.md)**.

## Repo map

```
Proyecto/
  certamen_1/            # Stage 1 (detector) + Stage 4 (condition grader) — original certamen
    pytorch/              03_*.py … 14_text_validator.py, src/, models/, output/
    tensorFlow/            same numbering, Keras instead of torch
  certamen_2/            # Stage 2 (text validator) + Stage 3 (price estimator) — this certamen's ask
    prepare_*_dataset.py  slow OCR/download step, run once, feeds the fast training scripts
    *_baseline.py          framework-agnostic sklearn baselines (already done, both stages)
    card_preprocessing.py, synthetic_wear.py  shared OpenCV helpers
  examen/
    trading-app-ionic/    Ionic/React app, on-device ONNX inference (src/lib/ml/)
    backend/               NestJS API + Prisma schema + docker/ (Postgres+MinIO+MailHog, dev only)
    desktop-runner/        Electron GUI for the whole pipeline above
```

## The 4-stage pipeline

| Stage | What | PyTorch | TensorFlow | Real vs. baseline |
|---|---|---|---|---|
| 1 — Detector (MTG/no-MTG) | binary classifier, transfer learning | ✅ done, Optuna done | ✅ done, Optuna done | real |
| 2 — Text validator (OCR match) | text-pair matching MLP over hashed n-grams | ✅ built, verified on synthetic data | ❌ not started | real (script exists), baseline already existed |
| 3 — Price estimator | regression, tabular (+ visual embedding planned) | ❌ not started | ❌ not started | only a tabular-only sklearn baseline exists so far |
| 4 — Condition grader (NM/LP/MP/HP/DMG) | 5-class classifier, transfer learning | ✅ done, Optuna done | ✅ done, Optuna done | real |

ONNX-exported and actually present in `trading-app-ionic/public/models/`
today: **only `stage1-detector.onnx` (PyTorch)**. The condition-grader export
scripts (both frameworks) and the TensorFlow Stage 1 export script exist and
compile, but have not actually been run for real yet — `stage4-condition-grader.onnx`
does not exist on disk anywhere yet.

## Hard rules established this project — read before touching training scripts

1. **Never hardcode a capability-disabling default to work around one
   machine's bug.** `pytorch/14_text_validator.py`'s `TextMatcher` triggers a
   reproducible ROCm/MIOpen segfault on `nn.Linear(2048, 256)` on this dev
   machine's AMD GPU (isolated down to a bare forward pass, any batch size).
   The fix is `DEVICE = "cuda" if torch.cuda.is_available() else "cpu"` as
   the default (same as every other script), plus an **opt-in**
   `--device {auto,cpu,cuda}` flag for whoever actually hits this bug. Do
   **not** default any script to CPU-only, GPU-off, etc. because of a bug
   specific to one environment — that silently disables acceleration for
   NVIDIA users and other AMD setups that don't have the bug. Apply this
   same pattern to Stage 3 before it ships.
2. **`shared-scraper` is destructive, `shared-downloader` is not.**
   `01_scraper.py` unconditionally overwrites `data/cards.json`, truncated to
   `--max-cards` (UI default 5,000) — running it automatically would silently
   shrink the real 58k+ card dataset. It is deliberately excluded from every
   automatic "run all" sequence in `desktop-runner`; only the idempotent
   `shared-downloader` runs automatically. The scraper is a manual, one-off
   step.
3. **ONNX export → Ionic convention.** Every `*_export_onnx*.py` script
   defines `IONIC_MODELS_DIR = .../examen/trading-app-ionic/public/models`
   and a small `publicar_en_ionic(destino, nombre_publico)` helper that
   copies the exported file there under a fixed name
   (`stage{N}-{name}.onnx`), no-ops with a warning if the Ionic project isn't
   present, and is skippable via `--no-ionic-copy`. Follow this exact
   pattern for Stage 2/3 export scripts — don't invent a new convention.
4. **`HashingVectorizer` for any new text-feature stage.** Deterministic
   (murmurhash3, fixed seed, no `.fit()`, no persisted vectorizer artifact),
   so PyTorch and TensorFlow can each instantiate it independently and still
   train on byte-identical input features — required for the cross-framework
   comparison to be fair. See `pytorch/src/text_matcher.py`.
5. **Split by `card_id`, not by row**, whenever one card can produce more
   than one dataset row (Stage 2: 2 rows/card; Stage 4: 5 rows/card). Splitting
   by row leaks the same card into both train and val. See
   `split_por_carta()` in `10_condition_grader.py` / `14_text_validator.py`.
6. **TensorFlow has no GPU path on AMD outside Docker.** There is no
   maintained ROCm wheel for `tensorflow>=2.16` (PyPI's `tensorflow-rocm`
   stopped at 2.9.4). `desktop-runner`'s GPU auto-detect already knows this
   and falls back TensorFlow to CPU cleanly on AMD — no `--device` flag
   needed on the TF side. The real fix is a Docker image (`rocm/tensorflow`)
   — see ROADMAP.md workstream D. Don't try to "fix" this with a pip flag.
7. **`RUN_ALL_*` sequences live in `scripts.config.ts`, not ad hoc.**
   `desktop-runner`'s "Correr TODO" runs 4 phases in order — download
   (`RUN_ALL_DOWNLOAD_SEQUENCE`) → PyTorch (`RUN_ALL_SEQUENCES.pytorch`) →
   TensorFlow (`RUN_ALL_SEQUENCES.tensorflow`) → export
   (`RUN_ALL_EXPORT_SEQUENCE`), implemented by `runEverything()` in
   `scripts.service.ts`. When Stage 2/3 scripts get registered, extend these
   arrays — don't add a parallel "run everything" path.

## Notable existing gaps found while reading the code (not yet fixed)

- `trading-app-ionic/README.md` says login/JWT isn't implemented on the
  backend yet ("el backend no tiene `/login` todavía"). This is stale:
  `backend/src/auth/presentation/auth.controller.ts` has a working
  `POST /auth/login`, and `AuthContext.tsx` already calls it for real. See
  ROADMAP.md, Documentation workstream.
- `10_condition_grader.py` / `11_optuna_condition_grader.py` (and their
  TensorFlow counterparts) are not registered as runnable scripts in
  `scripts.config.ts` — only their ONNX export scripts are. Worth confirming
  intentional before Stage 2/3 registration is designed around the same
  pattern.

## Environment notes (this dev machine specifically — not universal)

- AMD GPU via ROCm; `HSA_OVERRIDE_GFX_VERSION=10.3.0` needed for PyTorch on
  this card (mobile RDNA2, no official precompiled kernels) — already
  handled automatically by `desktop-runner`'s GPU detection.
- `tesseract` (system OCR binary, needed by `certamen_2`'s Stage 2 pipeline)
  is **not installed** on this machine and installing it needs `sudo`
  (password-protected, not attempted without asking). Blocks live
  OCR/dataset-prep runs here until installed (`sudo dnf install tesseract`).
- `certamen_2/.venv` was created ad hoc for dry-run testing during
  development — it is not yet a `desktop-runner`-registered environment.
