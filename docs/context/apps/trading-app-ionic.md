# `trading-app-ionic/` — the client app

Ionic React + Capacitor, PWA-or-native (Android APK build documented in
root `README.md`). All ML inference is on-device — see `okf/apps/README.md`.

**`Proyecto/examen/README.md` (the folder's own README) is stale on this
subject as of 2026-09-11** — it says no ONNX model exists yet and Stage
2/3/4 aren't wired. In reality all 4 stages are exported, published, and
have working client code as described below (verified directly against
`src/lib/ml/*` and `src/lib/scan/identifyCard.ts`, not against that README).

## `src/lib/` layout

| Path | What |
|---|---|
| `ml/stage1Detector.ts` | Stage 1 (MTG/no-MTG) inference — the reference loading pattern every other stage file follows. |
| `ml/stage2TextValidator.ts` | Stage 2 (OCR-text-vs-catalog-text match). |
| `ml/stage3PriceEstimator.ts` | Stage 3 (price regression) — PyTorch-only model, 1330-dim input built from `priceFeatures.ts` (tabular, 50-dim) + `stage1-embedder.onnx` (visual, 1280-dim). See `okf/models/README.md` for why. |
| `ml/stage4ConditionGrader.ts` | Stage 4 (condition grade) — always the combined checkpoint; class order `['NM','LP','MP','HP','DMG']` is a named constant, not alphabetical. |
| `ml/hashingVectorizer.ts` | TS port of the Python `HashingVectorizer` — must stay byte-identical to `pytorch/src/text_matcher.py`'s params or Stage 2 degrades silently. |
| `ml/ocrExtractor.ts` | In-browser OCR (`tesseract.js`) feeding Stage 2/identify at scan time — ports the "pre-cropped render" path of `text_validator_baseline.py::recortar_texto()`; the harder "raw camera frame with background" path is scoped separately (see below). |
| `ml/priceFeatures.ts` | Deterministic tabular feature builder for Stage 3, ported from `pytorch/src/price_features.py`. |
| `cv/cardLocalizer.ts` | OpenCV.js: contour-based card detection + perspective correction + CLAHE contrast enhancement in a live camera frame. |
| `cv/frameGeometry.ts` | Geometry helpers backing the localizer. |
| `camera/useLiveCamera.ts` | `getUserMedia` + `<canvas>` live capture hook. |
| `scan/identifyCard.ts` | **Which catalog card is this** — OCR the name → `GET /catalog/search` → OCR the rules text → `GET /catalog/search-by-text` → merge+rerank with Stage 2, rather than a full visual-embedding nearest-neighbor index over the 58k+ card catalog (rejected: Stage 1's backbone alone measured only ~18–25% real-photo Top-1, not worth the infra to serve it). See `okf/decisions/README.md`. |
| `scan/qrDecoder.ts` | QR decode, for the buyer/seller trading flow (ROADMAP.md workstream J). |
| `scan/useAuctionSocket.ts` | Live socket hook for the trading/auction flow. |
| `auth/AuthContext.tsx` | Session context backed by the backend's real JWT login (`POST /auth/login`) — persists `{accessToken, user}` as one blob, corrected on the next 401 rather than a "whoami" endpoint. Does **not** yet consume the backend's `{twoFactorRequired: true}` challenge response or `POST /auth/refresh` (logs out on any 401 instead of refreshing first) — see `apps/backend.md`. |

## Preprocessing pipeline still has a known gap

`ocrExtractor.ts` only handles OCR on an already-tightly-cropped card (e.g.
a Scryfall render). It deliberately does **not** yet handle "raw camera
frame with background" — that's `cardLocalizer.ts`'s job upstream, and as of
this writing the two aren't fully composed for OCR (they are composed for
the Stage 1–4 model inputs, which just need a resized frame, not a text
crop). If you're picking up OCR-quality work, check `cardLocalizer.ts` +
`ocrExtractor.ts`'s own header comments first — both are unusually well
narrated with exact ROADMAP.md item references.

## Pages (`src/pages/`)

`Tab1`–`Tab4` + `TabSearch` are the main tab bar (portfolio/treasury,
"Identify Artifact" scan flow, trade/buy, vault). `Buy.tsx`, `ListCard.tsx`,
`EditCard.tsx`, `CardDetails.tsx`, `TransactionDetails.tsx` round out the
marketplace flow; `Onboarding.tsx`, `AccountSettings.tsx`,
`PaymentSettings.tsx`, `SecuritySettings.tsx` are account-side.

## Model loading convention

ONNX files are fetched from `public/models/` (or wherever
`VITE_*_MODEL_URL` env vars point, per stage) and run via
`onnxruntime-web`. If a `stage{N}-*.onnx` file is missing, each stage file
handles that explicitly (no model = feature disabled, not a crash) — see
`stage1Detector.ts` for the reference pattern.
