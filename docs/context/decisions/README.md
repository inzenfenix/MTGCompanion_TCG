# Decisions & gotchas — the "why", not just the "what"

Settled reasoning that's easy to accidentally re-litigate or re-break
because the "why" isn't visible from the code alone. If you're about to
change something that touches one of these, read the entry first.

## ONNX export: `external_data=False` is load-bearing

`torch.onnx.export()`'s dynamo-based exporter defaults to splitting weights
into a separate `.onnx.data` sidecar file — `publicar_en_ionic()` never
copied that sidecar, so every PyTorch-sourced ONNX file published to Ionic
was silently unloadable by `onnxruntime` until this was found (root
`CLAUDE.md`, ROADMAP.md workstream C). All 4 PyTorch export scripts now
pass `external_data=False`. TensorFlow's `tf2onnx.convert.from_keras()` was
never affected (single file by default) — don't add this flag there, it
doesn't apply.

## Stage 4: combined checkpoint, not the plain one — on both frameworks

The plain `condition_grader.{pth,keras}` scores *higher* on its own
held-out split (95.25%) but collapses to 38.7% real-photo accuracy — it
overfit to whatever made the curated dataset easy. The combined
(real+synthetic) checkpoint generalizes to real photos (72.2%) despite the
lower own-split number. If you're tuning Stage 4 and see the plain
checkpoint's metrics look better, that's the trap, not a signal to switch —
`predict_condition.py` documents the same reasoning.

## Stage 3: PyTorch-only client-side, by construction

PyTorch's Stage 3 export needs a 1330-dim input (50 tabular + 1280 visual
from `stage1-embedder.onnx`, PyTorch-only); TensorFlow's needs 626 (50 +
576) and has no embedding-export equivalent. `stage3PriceEstimator.ts` only
builds the 1280-dim path. This is a real architectural asymmetry between
the two frameworks for this one stage, not a bug — see
`docs/context/models/README.md` for the export-ordering trick that keeps
`stage3-price-estimator.onnx` always PyTorch's regardless of which
framework's other stages "win."

## `identifyCard.ts`: OCR + catalog search, not a visual-embedding index

Rejected a full nearest-neighbor visual-embedding index over the ~58,679-card
catalog (would need a separate server-side pipeline to embed and serve
every catalog card's image) once real measurement showed Stage 1's backbone
alone gets only ~18–25% real-photo Top-1 accuracy — not worth building
server infra for that ceiling. The chosen path (OCR name → catalog search →
OCR rules text → second catalog search → merge+rerank with Stage 2) reuses
already-built pieces and runs client-side, no new backend surface. Revisit
only if a materially better visual backbone changes that ceiling number.

## `HashingVectorizer`, not a fitted/persisted vectorizer

Deterministic (murmurhash3, fixed seed, no `.fit()`) so PyTorch and
TensorFlow can each build the exact same input features independently,
without shipping/syncing a vectorizer artifact between frameworks — required
for the cross-framework comparison in `ml/data-prep` to be fair, and it's why
the client can reimplement it in TypeScript (`hashingVectorizer.ts`) instead
of needing to load a Python-trained artifact at inference time. Any new
text-feature stage should follow this same pattern (root `CLAUDE.md` rule
4), not introduce a persisted vectorizer.

## ONNX + `onnxruntime-web`, not TensorFlow.js

The professor suggested TensorFlow.js; the team chose ONNX instead because
`ml/data-prep` trains every stage in *both* frameworks and picks the winner
per stage independently — committing to TensorFlow.js would have forced
discarding a PyTorch win. ONNX covers whichever framework actually won each
stage, without knowing in advance which one that'll be.

## `shared-scraper` is destructive; `shared-downloader`/`shared-real-photos` aren't

`01_scraper.py` unconditionally overwrites `data/cards.json`, truncated to
`--max-cards` (UI default 5,000) — this is why it's excluded from every
"run all" sequence (`docs/context/tools/README.md`). Don't add it to an automatic
sequence to "make setup easier" — that's the exact failure mode it's
excluded to prevent (silently shrinking the real 58k+ card dataset down to
5,000).

## Split by `card_id`, never by row

Stage 2 produces 2 rows/card, Stage 4 produces 5 rows/card — splitting a
train/val set by row leaks the same card's other rows across the split.
`split_por_carta()` in `10_condition_grader.py`/`14_text_validator.py` is
the reference implementation; any new per-card multi-row dataset should
reuse this pattern, not `sklearn.train_test_split` directly on rows.
