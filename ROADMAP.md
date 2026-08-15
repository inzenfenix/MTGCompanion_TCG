# ROADMAP — what's left, by workstream

Companion to [CLAUDE.md](CLAUDE.md) (read that first for conventions/rules).
This file exists so several people can each own a workstream and work in
parallel without stepping on each other. Workstreams are mostly independent;
cross-workstream dependencies are called out explicitly.

Priority: **P0** blocks the graded deliverable (professor asked for two more
real, working models — Stage 2/3 — in a working pipeline, with Optuna) ·
**P1** needed for the app to actually demo end-to-end · **P2** polish/scope
beyond what's graded.

Complexity: **S** <2h · **M** half a day · **L** a full day+ · **XL** multi-day.

---

## A. Stage 2 — Text validator (OCR match), finish it

Text-pair matching MLP (`concat[v_ocr, v_ref, |diff|, product]` over
`HashingVectorizer` features) that scores whether an OCR'd photo actually
matches the card it's being compared against.

| # | Task | Priority | Complexity | Notes |
|---|---|---|---|---|
| A1 | ✅ `tensorFlow/12_text_validator.py` — Keras port of `pytorch/14_text_validator.py` | P0 | M | Done (15 ago). Same architecture (Functional API, not `Sequential` — see A5 note), same `HashingVectorizer` (`tensorFlow/src/text_matcher.py`, byte-identical params to the PyTorch side), same split-by-`card_id`, same metrics (ROC-AUC, Youden threshold, accuracy). No `--device` flag (CLAUDE.md rule 6). |
| A2 | ✅ Run `prepare_text_validator_dataset.py` for real (≥800 cards) | P0 | S* | Done (15 ago) — `tesseract` installed (`sudo dnf install tesseract`, documented in root `README.md` + `desktop-runner/README.md`). 791/800 cards OCR'd successfully (9 skipped), 1,582 pairs in `certamen_2/data/text_pairs/index.csv`. |
| A3 | ✅ Train both frameworks on the real dataset from A2, sanity-check metrics aren't just synthetic-data 1.0s | P0 | S | Done (15 ago). PyTorch ROC-AUC 0.9608, TensorFlow 0.9565 — both well above the 0.818 difflib-baseline and nowhere near a suspicious 1.0. PyTorch needed `--device cpu` (the documented ROCm/MIOpen segfault, CLAUDE.md rule 1 — not a new bug). |
| A4 | ✅ Optuna sweep, both frameworks (`hidden_units`, `dropout`, `lr`, `weight_decay`, optimizer — same search-space shape as `08_optuna_binary_classifier.py`, no `freeze_ratio`) | P0 | M | Done (15 ago) via `pytorch/15_optuna_text_validator.py` + `tensorFlow/13_optuna_text_validator.py`, mirroring `11_optuna_condition_grader.py`'s structure. Final: PyTorch 0.9646 ROC-AUC, TensorFlow 0.9634 — a **tie** by the project's own recommendation rule (`diff < 0.005` in `scripts.service.ts`). |
| A5 | ✅ `pytorch/16_export_onnx_text_validator.py` + TF counterpart (`tensorFlow/14_export_onnx_text_validator.py`) | P1 | M | Done (15 ago). Numbering note: `15` went to the PyTorch Optuna script above instead (train→optuna→export convention), so PyTorch export is `16_`, not the originally-planned `15_`. Both publish `stage2-text-validator.onnx` via `publicar_en_ionic()` (CLAUDE.md rule 3); numeric parity verified (PyTorch diff 0.00e+00, TensorFlow 8.80e-35). Found/fixed a real bug: TF's `build_text_matcher` had to move from `Sequential` to the Functional API (matching `condition_classifier.py`) because `Sequential` models lack `output_names`, which crashes `tf2onnx.convert.from_keras`. |

## B. Stage 3 — Price estimator, real model (not just the tabular baseline)

`price_estimator_baseline.py` (sklearn, tabular-only, log1p(price) target)
already exists and works. The graded ask is the *real* per-framework model:
same tabular features **plus** a visual embedding from the card image
(reuse Stage 1's backbone — EfficientNet_b0/MobileNetV3Small — as a frozen
feature extractor, same trick as Stage 4).

| # | Task | Priority | Complexity | Notes |
|---|---|---|---|---|
| B1 | ✅ Design the combined feature vector: tabular (rarity/set/type/colors/CMC one-hot, from `price_estimator_baseline.py`'s `ColumnTransformer`) concatenated with a frozen visual embedding | P0 | M | Done (15 ago) — written up in `certamen_2/README.md` §5.1.1. Tabular half: 48 dims, byte-identical across frameworks (9 numeric/binary + 15 hardcoded color/type one-hots + 24 dims from `rarity`/`set_type`/`frame`/`border_color` re-encoded with fixed vocab + "other" bucket instead of a fit-time `OneHotEncoder`, real vocab counted off all 58,679 `cards.json` rows). Visual half: reuses **Stage 1's already fine-tuned checkpoint** (`mtg_detector.pth`/`.keras`, both on disk), fully frozen, not vanilla ImageNet — PyTorch 1280 dims, TensorFlow 576 dims (verified against the real model, not the 1024 an earlier pass assumed) — different per framework by design, same situation as Stage 1/4's differing backbones. New shared module planned: `price_features.py`, duplicated into `pytorch/src/`/`tensorFlow/src/` mirroring `text_matcher.py`'s existing precedent (not written yet — B2/B3's job). Also flagged: a `certamen_2/prepare_price_dataset.py` prep step is needed to precompute+cache the frozen visual embeddings (backbone doesn't change per epoch, same reasoning as caching Stage 2's OCR once) — this is the "Stage 3's future prep script" C1 already anticipated, still unwritten. |
| B2 | ✅ `pytorch/15_price_estimator.py` | P0 | L | Done (15 ago) — trains `PriceRegressor` (new `src/price_regressor.py`) on `concat(x_tab, x_vis)`. `--device {auto,cpu,cuda}` applied from the start per CLAUDE.md rule 1 (needed the documented `HSA_OVERRIDE_GFX_VERSION=10.3.0` override to use the GPU on this machine, same as Stage 1/4). Needed 3 new supporting scripts/modules first: `certamen_2/prepare_price_dataset.py` (tabular CSV + card_id split.json + tabular_scaler.json), `pytorch/prepare_price_embeddings.py` (precomputes/caches Stage 1's frozen backbone embedding, 1280-d, confirmed), `pytorch/src/price_features.py` (48-dim tabular vectorizer, duplicated byte-identical into both frameworks per certamen_2/README.md §5.1.1). Verification run (`--n 1500`, not full dataset) completed end-to-end: checkpoint + cfg + versioned output/metrics/plots all produced correctly, `input_dim` confirmed exactly 1328 (48+1280) as designed. R²(log-USD) 0.107 — below the baseline's 0.521, expected given the 1,050-card train subsample vs. baseline's 41,298 (see certamen_2/README.md §5.1.2 for the full explanation) — not a design problem, a data-scale one. Full-dataset run + Optuna still pending (B4). |
| B3 | ✅ `tensorFlow/13_price_estimator.py` | P0 | L | Done (15 ago) — mirrors B2 exactly (same `price_regressor.py`/`price_features.py` pattern, Functional API per the ONNX-export lesson already learned for Stage 2). No `--device` flag (CLAUDE.md rule 6). New `tensorFlow/prepare_price_embeddings.py` pulls the frozen MobileNetV3Small submodel back out of `mtg_detector.keras` (576-d, confirmed). Same verification run: `input_dim` confirmed exactly 624 (48+576), R²(log-USD) 0.197 — same expected-low-at-this-scale caveat as B2. |
| B4 | Optuna sweep, both frameworks | P0 | M | Blocked on B2/B3's full-dataset run landing first (this session only ran a 1,500-card verification subsample). |
| B5 | ONNX export, both frameworks, `stage3-price-estimator.onnx` | P1 | M | Same convention as A5. |

**Dependency:** B blocks on nothing from A, can run fully in parallel. B1
should be settled before B2/B3 start (both frameworks need the same feature
contract).

## C. Desktop-runner integration (Stage 2 + Stage 3)

| # | Task | Priority | Complexity | Notes |
|---|---|---|---|---|
| C1 | Register a `certamen_2` venv/environment in `desktop-runner` (currently only certamen_1's `pytorch`/`tensorFlow` venvs are managed by the app; the `certamen_2/.venv` used during dev was ad hoc) | P1 | M | Still open. Needed so `prepare_text_validator_dataset.py`/`prepare_condition_dataset.py`/(Stage 3's future prep script) can get a "Crear venv" button — those dataset-prep scripts live in `certamen_2/`, outside `CERTAMEN_DIR` (= `certamen_1/`), so they're still invisible to the runner even after C2/C6 below. |
| C2 | ✅ Register `14_text_validator.py`/`12_text_validator.py`, their Optuna scripts, and their export scripts in `scripts.config.ts` (`pt-text-validator`/`pt-optuna-text-validator`/`pt-export-onnx-text-validator` + `tf-*` equivalents) | P1 | M | Done (15 ago) — registered under Stage 2's own subtab (see C7). `prepare_text_validator_dataset.py` itself is still **not** registered (blocked on C1 — different venv, `tesseract` dependency, one-off prep step rather than train/tune). |
| C3 | Same as C2 for Stage 3 scripts | P1 | M | Still fully blocked — no `pytorch`/`tensorflow` Stage 3 script exists yet (workstream B). Once B2/B3 land, follow the same registration pattern used for Stage 2/4 in `scripts.config.ts`, **and** add their ids to `FrameworkTab.tsx`'s `STAGE_SCRIPTS[fw].stage3` (currently an empty-array placeholder that renders a "no implementado todavía" card). |
| C4 | Extend `RUN_ALL_SEQUENCES` / `RUN_ALL_EXPORT_SEQUENCE` to include Stage 2/3 | P1 | S | Stage 2 done (15 ago) — `RUN_ALL_SEQUENCES` now trains Stage 2 + Stage 4 too (plain train only, Optuna stays manual on purpose), `RUN_ALL_EXPORT_SEQUENCE` now exports Stage 2's ONNX as well. `RunEverythingPanel.tsx`'s old hardcoded `TOTAL_STEPS` is gone — the panel no longer shows a step counter (see C7), so this no longer needs updating by hand. Stage 3 still pending, same blocker as C3. |
| C5 | Extend `ExportPanel.tsx` for non-classification metric shapes | P1 | M | Stage 2 done (15 ago) — added as `EXPORT_STAGES[1]` (`metricKey: 'roc_auc'`), fits the existing classification-shaped comparison fine as predicted. Stage 3 (regression: MAE/RMSE/R², "lower is better") is still open — still needs its own metric block and its own winner-picking logic, `getExportComparison()`'s `recommendation` logic in `scripts.service.ts` still assumes bigger `metricKey` wins. |
| C6 | ✅ Confirm whether `10_condition_grader.py`/`11_optuna_condition_grader.py` (+ TF) being unregistered in `scripts.config.ts` is intentional; register if not | P2 | S | Done (15 ago) — not intentional, registered as `pt-condition-grader`/`pt-optuna-condition-grader` + `tf-*` equivalents. Also registered `pytorch/12_condition_grader_combined.py` (`pt-condition-grader-combined`) and `pytorch/predict_condition.py` (`pt-predict-condition`, Stage 4's "Testear" step) — `predict_condition.py` loads `condition_grader_combined.pth`, not the plain `condition_grader.pth`, so it needed the combined-training script registered too to actually be runnable end-to-end. No TensorFlow equivalent of `predict_condition.py`/the combined-training script exists yet — Stage 4's TF subtab has no "Testear" card, not invented. |
| C7 | ✅ Reorganize the runner's UI: rename "Dataset compartido" tab to "Scraper" (same content — catalog scraper + image downloader + negative-cards download, still one tab, just a clearer/cooler name); a subtab per stage (1–4) inside PyTorch/TensorFlow, entrenar→hipertunear per stage; exporters removed from the framework tabs (Exportar-only now); per-tab status icon (missing/running/success/error) driven by `run-all-step`/`run-all-report`, auto-switching to whichever tab/subtab is currently executing | P1 | L | Done (15 ago). New: `apps/renderer/src/components/FrameworkTab.tsx` (stage subtabs, curated by id via its `STAGE_SCRIPTS` map — same "curate by id, not by `group`" pattern `ExportPanel.tsx` already used), `apps/renderer/src/lib/useRunAllStatus.ts` (the status-icon hook, shared by `App.tsx` and `FrameworkTab.tsx`). `RunEverythingPanel.tsx`/`RunAllPanel.tsx` are now just a button + final summary — the live console/chart/results moved into each script's own `ScriptCard`, which now adopts the `run-all-step` runId for its own id instead of needing a separate log panel. **Whoever does C3 needs to know this pattern** — a new Stage 3 script needs an id in both `scripts.config.ts` (as before) and `FrameworkTab.tsx`'s `STAGE_SCRIPTS[fw].stage3` array (and `RUN_ALL_SEQUENCES`/`RUN_ALL_EXPORT_SEQUENCE`/`App.tsx`'s `TAB_BUCKETS` for it to participate in "Correr Todo" + get a status icon). |

**Dependency:** C3 needs B2/B3 (the scripts to register) to exist; C1 has no
dependency and can start immediately — it's the only piece of workstream C
still fully unblocked-but-undone.

## D. AMD/ROCm Docker image for TensorFlow GPU

There's no maintained ROCm pip wheel for modern TensorFlow — the only path
to GPU-accelerated TF training on AMD is Docker (`rocm/tensorflow` image).
Currently `desktop-runner` detects this and cleanly falls back TF to CPU;
this workstream is about actually giving TF a GPU path, not fixing a bug.

| # | Task | Priority | Complexity | Notes |
|---|---|---|---|---|
| D1 | ✅ Spike: pull `rocm/tensorflow` (pick a tag matching this GPU's ROCm version), confirm `tf.config.list_physical_devices('GPU')` sees the card inside the container | P2 | M | Done (15 ago). Tag `rocm7.1.1-py3.12-tf2.20-dev`, chosen by querying the live Docker Hub tag list and matching this host's installed ROCm userspace (7.1.1) exactly. Confirmed `GPU:0` = "AMD Radeon RX 6800S" inside the container and ran a real matmul on it — needed the same `HSA_OVERRIDE_GFX_VERSION=10.3.0` override as PyTorch (gfx1032 has no official precompiled ROCm kernels; without it TF silently ignores the device: "Ignoring visible gpu device ... with AMDGPU version : gfx1032"). Also found and fixed a real bug along the way: `pip install -r requirements.txt` inside the container silently replaces the image's ROCm-compiled TensorFlow with a stock CPU-only PyPI wheel (unpinned `tensorflow>=2.16` doesn't parse-match the image's non-PEP440 version string `2.20.0-dev0+selfbuilt`, and `optuna-integration[tfkeras]`'s extra pulls in the same bare `tensorflow` dependency independently) — caused a real `ImportError` mid-spike. Fixed by stripping both before install; see `desktop-runner/docker/tf-rocm/README.md` § "Known gotchas" for the full writeup. |
| D2 | ✅ Wire it into `desktop-runner`: either (a) a "Run TensorFlow scripts in Docker" toggle that shells out to `docker run` instead of the local venv, or (b) document it as a manual escape hatch in the README and leave venv/CPU as the default UI path | P2 | L | Done (15 ago) — went with (b), as recommended: `desktop-runner/docker/tf-rocm/run.sh` (Linux launcher, host-agnostic — same flags on Fedora/Nobara/Ubuntu) + `README.md` (host setup per OS, image-tag reasoning, Windows called out as genuinely unsupported — AMD's own docs exclude RDNA2 *mobile* SKUs like the RX 6800S/6700S from ROCm entirely, WSL2 included). Linked from `desktop-runner/README.md`'s existing GPU section. Not wired into the UI, per (b)'s reasoning already in this row. |
| D3 | ✅ Document GPU/CPU training time difference for TF once D1 exists, so the tradeoff is a data point, not a guess | P2 | S | Done (15 ago), measured for real on this laptop, `07_binary_classifier.py --n 150 --epochs 2` (tiny slice — frozen MobileNetV3Small backbone, 0.9M trainable params): steady-state per-step GPU is **~1.5x faster** (139ms vs 210ms/step), but total wall-clock GPU was **~3x slower** (62.9s vs 20.8s) at this toy scale — swallowed by one-time fixed cost (XLA compiling ROCm kernels ~30s, container pip install, backbone re-download since `--rm` containers don't persist the Keras cache). Extrapolated (not measured) to the real default (`--n 3000 --epochs 15`, ≈150 steps/epoch): GPU comes out **~25–30% faster wall-clock** once fixed cost amortizes. Full numbers + methodology in `desktop-runner/docker/tf-rocm/README.md` § "Measured: GPU vs CPU". Worth re-measuring on a real full run once Stage 3 (workstream B, heavier per-step compute) lands — more representative than this toy binary-classifier slice. |

**Dependency:** none — fully independent of A/B/C, can be picked up any time.
Low urgency: every TF script already works on CPU today, this is a speed
optimization, not a correctness blocker. **Workstream D is now fully done.**

## E. Ionic integration

| # | Task | Priority | Complexity | Notes |
|---|---|---|---|---|
| E1 | `src/lib/ml/stage2TextValidator.ts`, mirroring `stage1Detector.ts` (same `onnxruntime-web` loading pattern, `VITE_STAGE2_MODEL_URL` env var w/ `/models/stage2-text-validator.onnx` default) | P1 | M | Needs A5's exported `.onnx` to exist to test against. |
| E2 | `src/lib/ml/stage3PriceEstimator.ts`, same pattern | P1 | M | Needs B5. |
| E3 | OCR in the browser (`tesseract.js`) to feed Stage 2 at scan time | P1 | L | Ionic README already flags this as unbuilt ("OCR es trabajo futuro con tesseract.js"). Needs to crop the text region client-side the same way `card_preprocessing.py`/`text_validator_baseline.py` does server-side, or accept lower accuracy without the crop step. |
| E4 | Wire Stage 4 (condition grader) ONNX into Ionic once it's actually exported (see CLAUDE.md — not done yet) | P1 | S | Export script + `publicar_en_ionic()` already exist; just needs an actual run (like Stage 1's was) plus a `stage4ConditionGrader.ts` wrapper. |
| E5 | Wire `POST /transactions` into the Trade Nexus UI flow (API client already exposes it, just not called from a component) | P2 | S | |
| E6 | Bazaar tab: replace sample data with a real backend-backed listing endpoint | P2 | M | Needs a backend endpoint first — coordinate with workstream F. |
| E7 | Treasury balance (Tab 1) — currently a hardcoded mock (`$1,250.00`) | P2 | M | Blocked on backend `balance`/wallet design (see F5) — deliberately deferred on both sides, don't build one without the other. |

**Dependency:** E1/E2/E4 need exported `.onnx` files from A/B and the
already-pending Stage 4 export run. E3/E5/E6/E7 are backend/UX work,
independent of the ML workstreams.

## F. Backend

| # | Task | Priority | Complexity | Notes |
|---|---|---|---|---|
| F1 | Fix stale doc: `trading-app-ionic/README.md` "Qué falta" still claims `/login` doesn't exist — it does (`auth.controller.ts`), and `AuthContext.tsx` already calls it for real | P2 | S | Pure doc fix, see CLAUDE.md "Notable existing gaps". |
| F2 | `MercadoPagoProvider` implementing the existing `PaymentProvider` interface, swap `useClass` in `payments.module.ts` | P2 | L | `TransactionsService` doesn't need to change — interface is already designed for this. |
| F3 | Refresh tokens (`POST /auth/refresh`) | P2 | M | `JWT_REFRESH_TTL` already reserved in `.env.example`. |
| F4 | TOTP-based 2FA | P2 | L | Schema already has `twoFactorEnabled`/`twoFactorSecret` on `UserSettings`, no logic yet. |
| F5 | User balance/wallet — derive from real `Transaction` rows once payments (F2) exist | P2 | M | Deliberately not modeled yet; do this together with E7. |
| F6 | Card catalog seeding: bulk-import Scryfall metadata (`certamen_1/data/cards.json`) into a queryable catalog table/endpoint for Bazaar search (today `Card.scryfallId/setName/rarity/oracleText` are only filled in per-owned-card, there's no browsable catalog) | P1 | L | Needed for E6 (Bazaar) to be real. Existing `prisma/seed.ts` only seeds a couple of demo users/cards for local dev login testing — this is a different, bigger job (tens of thousands of catalog rows, probably its own table, not reusing `Card` which represents an *owned* physical card). |

**Dependency:** F6 blocks E6. F2 blocks F5/E7. Otherwise independent of the ML workstreams — a backend person can start immediately.

## G. Testing

| # | Task | Priority | Complexity | Notes |
|---|---|---|---|---|
| G1 | Unit tests for the new Stage 2/3 modules (`text_matcher.py`, the price-estimator feature builder) — architecture shape, forward-pass shape, loss decreasing on a tiny synthetic batch | P1 | M | Same spirit as the synthetic-data smoke tests already done manually for Stage 2 during dev — formalize into `pytest`. Neither `certamen_1` nor `certamen_2` currently has a test suite; `tensorFlow/tests/` exists but is thin — check what's there before assuming a from-scratch setup. |
| G2 | Backend e2e tests for any new endpoints (F2/F3/F6) | P1 | M | Only 2 `*.e2e-spec.ts` files exist today — establish the pattern for new modules as they land, not as an afterthought. |
| G3 | Ionic component/integration tests for `stage2TextValidator.ts`/`stage3PriceEstimator.ts` loading + inference | P2 | M | Mock ONNX Runtime the same way `stage1Detector.ts`'s existing tests (if any — verify) do it. |
| G4 | End-to-end scanner accuracy check on real (non-synthetic, non-render) phone photos, all 4 stages chained | P0 | M | This is the check that actually matters for the "flujo de trabajo que funcione" ask — synthetic-data 1.0 metrics (already seen with Stage 2 in dev) are not evidence of anything by themselves. Reuse `test_photos/`/`compare_scanners.py` pattern from certamen_1. |

**Dependency:** G4 needs A/B finished enough to chain all 4 stages; G1 can start as soon as A/B's modules exist, even before training finishes for real.

## H. Statistics & reporting

One consolidated results document/notebook that every other workstream's
numbers feed into — useful both for the report deliverable and as the
"which framework wins per stage" source of truth that `ExportPanel.tsx`
already partially automates.

| # | Task | Priority | Complexity | Notes |
|---|---|---|---|---|
| H1 | Stage 1 & 4 (classification): consolidate precision/recall/F1/ROC-AUC/accuracy already produced by existing `final_metrics.json` outputs, both frameworks, into one comparison table | P1 | S | Data already exists (Optuna runs done) — this is aggregation, not new measurement. |
| H2 | Stage 2 (classification): same metric set (ROC-AUC, Youden-threshold accuracy, F1) once A3/A4 produce real numbers | P0 | S | Depends on A. |
| H3 | Stage 3 (regression): MAE, RMSE, R², median absolute error — `price_estimator_baseline.py` already computes these for the baseline; extend to the real model once B2/B3 land | P0 | S | Depends on B. Report on the untransformed price scale (undo the log1p), not just log-space error, since that's what's actually meaningful to a user. |
| H4 | Stage 1 retrieval/embedding quality: Top-1 (and maybe Top-5) card-identification accuracy from `04_evaluate.py`'s embedding index, both frameworks | P1 | S | This metric already exists from certamen_1 — pull it in rather than re-deriving it. |
| H5 | Cross-framework winner table (mirrors what `ExportPanel.tsx` computes live, but as a static document for the report) | P1 | S | Depends on H1–H4 all being filled in. |
| H6 | "Curated data vs. real photo" gap write-up | P1 | S | Already partially observed anecdotally (Stage 1 Optuna confidence: 100% on validation → ~91% on one real out-of-distribution phone photo). Formalize using G4's real-photo test results once available. |

**Dependency:** H2/H3 block on A/B; H1/H4 can be written today with existing data; H6 blocks on G4.

---

## Suggested parallel assignment (4 people)

- **Person 1 — ML/Stage 2:** workstream A end-to-end.
- **Person 2 — ML/Stage 3:** workstream B end-to-end.
- **Person 3 — App integration:** workstream C — C1/C3/C5(Stage 3 part) still open (blocked on B), C2/C4(Stage 2 part)/C6/C7 done (15 ago) — then E1/E2/E4 as A/B's exports land.
- **Person 4 — Backend/testing/reporting:** workstream F (F6 first, it unblocks E6), G, H (H1/H4 immediately, H2/H3/H5/H6 as A/B land).
- **Workstream D** (AMD Docker) — ✅ done (15 ago), was low-urgency and self-contained filler; see `desktop-runner/docker/tf-rocm/`.
