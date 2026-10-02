# Tools & conventions

Shared dev tooling and conventions across `ml/training/`, `ml/data-prep/`, and
by extension anything `apps/` consumes from them. Full detail (script
inventory, args) lives in root `docs/architecture/PIPELINE_INTEGRATION.md` — **treat that
file's "Stage 2/3 don't exist yet" framing as stale** (see
`docs/context/README.md`'s freshness policy); its structural/contract description
below is still accurate.

## venv-per-framework, never a global `python`/`pip`

Each of `pytorch/`, `tensorFlow/`, and `ml/data-prep/` has its own `.venv`,
never mixed. The only exception is the shared dataset scripts at the root of
`ml/training/` (`01_scraper.py`, `02_downloader.py`), which need only
`requests` and don't have their own venv. Any automation (`desktop-runner`,
a subagent, a shell one-liner) must invoke the venv's own interpreter
directly (`<carpeta>/.venv/bin/python`), never a bare `python` off `PATH`.
Reference pattern for "create venv if missing, install `requirements.txt`
idempotently, retry with a pyenv-found 3.9–3.12 if TensorFlow's install
fails on too-new a Python": `ml/training/04_evaluate.py`,
`asegurar_venv()`. Reuse it (invoke the script) rather than reimplementing
venv bootstrap logic elsewhere.

## The CLI contract every script follows

- `argparse`-based, no interactive `input()` prompts — every parameter is a
  flag with a sensible default.
- **Exit code 0 = success, nonzero = failure.** No silent-success-with-a-
  failure bug (this was a real bug once, fixed in both frameworks'
  `04_evaluate.py`).
- Progress via line-by-line stdout, parseable — `tqdm` is used for
  downloads and degrades to plain `N/total` lines automatically when stdout
  isn't a TTY (e.g. spawned by `desktop-runner`), no ANSI bars to parse.
- **Results go to `output/{framework|baseline}/{timestamp}/`, with a
  `latest/` symlink** (or a copy where symlinks aren't available, e.g.
  Windows without admin). This directory **is committed to git** on purpose
  — it's the metrics history.
- **Model/binary artifacts never go to `output/`** — they go to a local,
  gitignored `models/` folder (`pytorch/models/`, `tensorFlow/models/`,
  `ml/data-prep/models/`). `output/` only holds lightweight JSON + PNGs.

## `HashingVectorizer` for text features

Deterministic (murmurhash3, fixed seed, no `.fit()`, no persisted
vectorizer artifact) — see `pytorch/src/text_matcher.py`. This is what lets
PyTorch and TensorFlow train on byte-identical input features independently,
which is required for the cross-framework comparison to be meaningful. The
client reimplements the same hashing in TypeScript
(`apps/mobile/src/lib/ml/hashingVectorizer.ts`) so Stage 2 inference
in the browser produces the same features the models were trained on — if
you ever touch the Python version's params (seed, n_features, n-gram range),
the TS port has to change in lockstep or Stage 2 silently degrades.

## Shared OpenCV helpers (`ml/data-prep/`)

- `card_preprocessing.py` — crop/perspective/normalize a card photo, shared
  across dataset-prep scripts.
- `synthetic_wear.py` — synthetic wear/damage augmentation, used to build
  the "combined" Stage 4 training set (see `docs/context/models/README.md`).
- `synthetic_sleeve.py` — sleeve augmentation, wired via `--con-fundas` but
  **not yet used** in any retrain (ROADMAP.md item I20, points 3/4) —
  neither framework's combined Stage 4 checkpoint has seen sleeved cards.

The client mirrors the relevant parts of this preprocessing in
`apps/mobile/src/lib/cv/` (`cardLocalizer.ts`, `frameGeometry.ts`) —
JS/OpenCV.js side of the same crop-and-normalize step, since inference has
to run in-browser (see `docs/context/apps/trading-app-ionic.md`).

## Optuna

Every stage/framework has an `NN_optuna_*.py` companion script. Notable
patterns:
- `--resume-dir` picks up an interrupted study without re-running completed
  trials — `Ctrl+C`/`SIGINT`/`SIGTERM` leaves `study.db` consistent, safe to
  kill from `desktop-runner`'s "stop" button.
- Pruning: PyTorch scripts call `trial.report()`/`trial.should_prune()`
  manually; TensorFlow scripts need the `optuna-integration[tfkeras]` extra
  for its pruning callback instead (see each script's `requirements.txt`).
- PyTorch scripts print the detected `Device` (`cuda`/`cpu`) at startup;
  TensorFlow scripts don't — add it there if a UI needs to surface it.

## `desktop-runner` as the pipeline orchestrator

`apps/desktop-runner/` is the Electron GUI that wraps every
script above — see `docs/context/apps/desktop-runner.md` for its own architecture.
Two things worth knowing at this level:

- **`RUN_ALL_*` sequences are declared in `scripts.config.ts`, not ad hoc**
  (root `CLAUDE.md` rule 7) — `RUN_ALL_DOWNLOAD_SEQUENCE` → per-framework
  `RUN_ALL_SEQUENCES` → `RUN_ALL_EXPORT_SEQUENCE`, run in order by
  `runEverything()` in `scripts.service.ts`.
- **`shared-scraper` (`01_scraper.py`) is deliberately excluded from every
  automatic sequence.** It unconditionally overwrites `data/cards.json`,
  truncated to `--max-cards` (UI default 5,000) — running it automatically
  would silently shrink the real 58k+ card dataset. `shared-downloader`
  (`02_downloader.py`) and `shared-real-photos`
  (`03_real_photos_downloader.py`) are both idempotent and safe to include.
  Re-scraping stays a manual, one-off button in the "Scraper" tab.

## System dependency: `tesseract`

`ml/data-prep`'s Stage 2 pipeline (`prepare_text_validator_dataset.py`, via
`text_validator_baseline.py`) needs the system `tesseract` OCR binary, not a
pip package. It's confirmed installed on the primary dev machine
(`tesseract 5.5.2`) — see `docs/context/environment/README.md`. The client also does
OCR (`apps/mobile/src/lib/ml/ocrExtractor.ts`), but via `tesseract.js`
(WASM, in-browser) — a separate distribution with its own bundled
trained-data assets (`npm run setup:tesseract`,
`scripts/setup-tesseract-assets.mjs`), not the system `tesseract` binary.
Those bundled assets going missing from a CI-built/local APK was a real,
already-fixed bug (see recent git history) — if OCR ever regresses to a
`NetworkError` on-device again, check that script/asset pipeline first, not
the Python/system side.
