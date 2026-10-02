# Models — the 4-stage pipeline as consumed by `examen/`

Full training detail lives in `Proyecto/certamen_1/` (Stage 1 + 4) and
`Proyecto/certamen_2/` (Stage 2 + 3, plus shared preprocessing) — see root
`CLAUDE.md`'s pipeline table for the canonical status. This file is the
"what actually ships to the client" view: which checkpoint each stage uses,
what's on disk, what's exported, and the gotchas that mattered for `examen/`
specifically.

## The 4 stages

| Stage | Task | PyTorch script(s) | TensorFlow script(s) | Framework used client-side |
|---|---|---|---|---|
| 1 — Detector (MTG/no-MTG) | binary classifier | `pytorch/07_binary_classifier.py`, `08_optuna_binary_classifier.py` | `tensorFlow/07_binary_classifier.py`, `08_optuna_binary_classifier.py` | either — see "last exporter wins" below |
| 2 — Text validator (OCR match) | text-pair MLP over hashed n-grams | `pytorch/14_text_validator.py`, `15_optuna_text_validator.py` | `tensorFlow/12_text_validator.py`, `13_optuna_text_validator.py` | either |
| 3 — Price estimator | regression, tabular + frozen visual embedding | `pytorch/15_price_estimator.py`, `17_optuna_price_estimator.py` | `tensorFlow/13_price_estimator.py`, `15_optuna_price_estimator.py` | **PyTorch only** — see gotcha below |
| 4 — Condition grader (NM/LP/MP/HP/DMG) | 5-class classifier | `pytorch/10_condition_grader.py` (plain) + `12_condition_grader_combined.py` (real+synthetic) | `tensorFlow/09_condition_grader.py` (plain) + `11_condition_grader_combined.py` (real+synthetic) | either — but always the **combined** checkpoint, never the plain one |

## What's actually on disk (gitignored — invisible in `git status`)

`pytorch/models/` and `tensorFlow/models/` (both under `Proyecto/certamen_1/`)
hold the trained checkpoints per framework: `mtg_detector.{pth,keras}`,
`text_matcher.{pth,keras}`, `price_regressor.{pth,keras}` +
`price_embedding.onnx` (PyTorch-only, see below), and
`condition_grader_combined.{pth,keras}`. Each has a matching `_cfg.json`
(architecture/hyperparameters) and a `.onnx` export sitting next to it.
None of this is committed to git — if it's missing on a fresh checkout, it
needs re-training (`desktop-runner`'s "Correr TODO", or the individual
scripts) before export/publish will produce anything.

## What's published to the client (`trading-app-ionic/public/models/`)

```
stage1-detector.onnx          # Stage 1 classifier (sigmoid logit)
stage1-embedder.onnx          # Stage 1 backbone as a raw 1280-dim embedding — PyTorch-only, exists only for Stage 3's visual features (see below)
stage2-text-validator.onnx    # Stage 2 text-pair matcher
stage3-price-estimator.onnx   # Stage 3 regressor
stage3-tabular-scaler.json    # mean/std for Stage 3's 6 numeric tabular fields
stage4-condition-grader.onnx  # Stage 4 combined-checkpoint classifier
```

Publishing is done by each `*_export_onnx*.py` script's `publicar_en_ionic()`
helper (root `CLAUDE.md` rule 3) — re-running export overwrites these files
in place, no manual copy step.

## Gotchas that matter here (see `okf/decisions/README.md` for full "why")

- **`external_data=False` fix.** Every PyTorch export script now passes this
  to `torch.onnx.export()` — without it, `torch`'s dynamo exporter silently
  split weights into a `.onnx.data` sidecar that never got copied to Ionic,
  making the published file unloadable by `onnxruntime` until this was
  found. TensorFlow's `tf2onnx` was never affected.
- **Stage 4 uses the combined checkpoint, not the plain one, on both
  frameworks.** `condition_grader.pth`/`.keras` (plain) scores higher on its
  own held-out split but collapses on real photos; `condition_grader_combined.*`
  (real+synthetic training data) is what actually generalizes — 72.2% vs.
  38.7% real-photo accuracy on the PyTorch side (TensorFlow's combined
  checkpoint: 0.657 accuracy / 0.637 f1_macro, trained on 1,184 real
  Roboflow photos + 800 synthetic). Neither combined checkpoint has trained
  on sleeve-augmented data yet (`synthetic_sleeve.py` exists, wired via
  `--con-fundas`, unused so far — ROADMAP.md item I20).
- **Stage 3 is PyTorch-only client-side, on purpose, by construction — not a
  missing feature.** PyTorch's `stage3-price-estimator.onnx` expects a
  1330-dim input (50 tabular + 1280 visual, from `stage1-embedder.onnx`);
  TensorFlow's expects 626 (50 + 576) — the two are not interchangeable, and
  there is no TensorFlow equivalent of `stage1-embedder.onnx`
  (`19_export_onnx_price_embedding.py` is PyTorch-only).
  `trading-app-ionic/src/lib/ml/stage3PriceEstimator.ts` only knows how to
  build the 1280-dim input, so the TensorFlow Stage 3 model is simply never
  usable from the client. `desktop-runner`'s `RUN_ALL_EXPORT_SEQUENCE`
  (`scripts.config.ts`) deliberately runs TensorFlow's Stage 3 export
  *before* PyTorch's, so whichever framework wins for the other stages,
  the file left published at `stage3-price-estimator.onnx` is always
  PyTorch's. Stage 1/2/4 don't have this constraint — both frameworks
  publish the same input/output contract under the same public filename,
  so "whichever export ran last wins" is harmless there.
- **Stage 3's tabular feature count is 50, not 48/1328** — a naming/shape
  assumption an earlier pass got wrong; `priceFeatures.ts` and
  `N_TAB_FEATURES` are the source of truth, don't hardcode the number
  elsewhere.

## Where metrics live

Versioned run history: `output/{framework}/{timestamp}/` (or
`output/{framework}/optuna/{timestamp}/` for Optuna runs), with a `latest/`
symlink — this is committed to git on purpose (it's the metrics history).
Model binaries themselves never go here — see `okf/tools/README.md`.
