/**
 * Stage 3 (price estimation) client-side inference, via `onnxruntime-web` —
 * same loading pattern as `stage1Detector.ts`, but the input tensor is built
 * from TWO sources, not raw pixels alone (verified directly against the
 * real exported model, ROADMAP.md workstream E, E2):
 *
 *   input `features` [batch, 1330] = concat[tabular(50), visual(1280)]
 *   output `price_log1p` [batch, 1] (raw — apply `Math.expm1` for USD, same
 *   undo-log1p as `price_estimator_baseline.py`)
 *
 * (1330 = 50, not the 1328/48 an earlier pass here assumed — ROADMAP.md B6
 * added `edhrec_rank_conocido`/`edhrec_rank_log` to close the tabular
 * feature set's information ceiling; `priceFeatures.ts` already reflects
 * the 50-dim layout, this file just needs `N_TAB_FEATURES` to stay
 * imported, not hardcoded, so it doesn't drift out of sync again.)
 *
 * - **tabular (50-dim)**: deterministic, rule-based — `priceFeatures.ts`,
 *   ported from `pytorch/src/price_features.py`. Needs a `tabular_scaler.json`
 *   (mean/std for 6 numeric fields) fetched at runtime — see
 *   `STAGE3_SCALER_URL` below and its "not yet published" caveat.
 * - **visual (1280-dim)**: Stage 1's frozen EfficientNet_b0 backbone
 *   embedding (`modelo.flatten(modelo.avgpool(modelo.features(x)))`), which
 *   `stage1-detector.onnx` does **not** expose (it only outputs the final
 *   classification `logit`). Needed a separate export
 *   (`pytorch/19_export_onnx_price_embedding.py`) that publishes just that
 *   intermediate tensor as `stage1-embedder.onnx` — same checkpoint, same
 *   preprocessing, verified numeric parity 3.5e-06 against the real
 *   PyTorch model (real card photo; the script's default random-tensor
 *   input runs closer to its tolerance, see that script's own comment).
 *
 * `tabular_scaler.json` (full-catalog, 51,939 priced cards, ROADMAP.md B2/B6)
 * is now published — `prepare_price_dataset.py` copies it to
 * `public/models/stage3-tabular-scaler.json` itself when run without `--n`
 * (ROADMAP.md E2, 16 ago). `getScaler()` below still fails loudly
 * (`'error'` status) rather than guessing if that file is ever missing.
 *
 * **Verified end-to-end (16 ago)**, same method as E1's Stage 2 test —
 * real cards, `onnxruntime-node` against the real published `.onnx` files,
 * compared to the real PyTorch model's own output (`predict_price.py`):
 * feeding the same real visual embedding through this module's tabular
 * builder + `stage3-price-estimator.onnx` matches PyTorch to ~1e-7 log1p
 * (float32 noise). The one part NOT bit-verified is the browser's own
 * image resize inside `preprocess()` below vs. PyTorch's `PIL`/
 * `torchvision.transforms.Resize` — confirmed these use different
 * interpolation conventions (corner pixels match, interior pixels don't),
 * which shows up as a few-percent price drift end-to-end. This is a
 * pre-existing gap shared by every image-preprocessing stage in this app
 * (`stage1Detector.ts`, `stage4ConditionGrader.ts` included, never bit-
 * verified either) — not something new or specific to Stage 3, and not
 * fixed here; a real fix would mean porting PyTorch's exact resize
 * algorithm client-side, arguably the same territory as G4c's planned
 * OpenCV.js work.
 */

import { buildTabularVector, escalarNumericos, N_TAB_FEATURES, type ScryfallCardFields, type TabularScaler } from './priceFeatures';

type OrtModule = typeof import('onnxruntime-web');

const STAGE3_EMBEDDER_URL: string =
  (import.meta.env.VITE_STAGE3_EMBEDDER_URL as string | undefined) ?? '/models/stage1-embedder.onnx';
const STAGE3_MODEL_URL: string =
  (import.meta.env.VITE_STAGE3_MODEL_URL as string | undefined) ?? '/models/stage3-price-estimator.onnx';
const STAGE3_SCALER_URL: string =
  (import.meta.env.VITE_STAGE3_SCALER_URL as string | undefined) ?? '/models/stage3-tabular-scaler.json';

const IMG_SIZE = 224;
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;
const VISUAL_EMBEDDING_DIM = 1280;

export type Stage3Result = {
  /** Estimated price in USD (already `expm1`'d back from log-space). */
  priceUsd: number;
};

export type Stage3Status =
  | { status: 'unavailable' } // embedder or price model missing at their URLs
  | { status: 'error'; message: string }
  | { status: 'ok'; result: Stage3Result };

let embedderSessionPromise: Promise<import('onnxruntime-web').InferenceSession | null> | null = null;
let priceSessionPromise: Promise<import('onnxruntime-web').InferenceSession | null> | null = null;
let scalerPromise: Promise<TabularScaler | null> | null = null;

async function headOk(url: string): Promise<boolean> {
  const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
  return !!head && head.ok;
}

async function getEmbedderSession() {
  if (!embedderSessionPromise) {
    embedderSessionPromise = (async () => {
      if (!(await headOk(STAGE3_EMBEDDER_URL))) return null;
      const ort: OrtModule = await import('onnxruntime-web');
      return ort.InferenceSession.create(STAGE3_EMBEDDER_URL);
    })();
  }
  return embedderSessionPromise;
}

async function getPriceSession() {
  if (!priceSessionPromise) {
    priceSessionPromise = (async () => {
      if (!(await headOk(STAGE3_MODEL_URL))) return null;
      const ort: OrtModule = await import('onnxruntime-web');
      return ort.InferenceSession.create(STAGE3_MODEL_URL);
    })();
  }
  return priceSessionPromise;
}

async function getScaler(): Promise<TabularScaler | null> {
  if (!scalerPromise) {
    scalerPromise = (async () => {
      const resp = await fetch(STAGE3_SCALER_URL).catch(() => null);
      if (!resp || !resp.ok) return null;
      return (await resp.json()) as TabularScaler;
    })();
  }
  return scalerPromise;
}

/** Same 224×224 / ImageNet-normalization contract as stage1Detector.ts / stage4ConditionGrader.ts. */
function preprocess(canvas: HTMLCanvasElement, ort: OrtModule): InstanceType<OrtModule['Tensor']> {
  const resized = document.createElement('canvas');
  resized.width = IMG_SIZE;
  resized.height = IMG_SIZE;
  const ctx = resized.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.drawImage(canvas, 0, 0, IMG_SIZE, IMG_SIZE);

  const { data } = ctx.getImageData(0, 0, IMG_SIZE, IMG_SIZE);
  const chw = new Float32Array(3 * IMG_SIZE * IMG_SIZE);
  const plane = IMG_SIZE * IMG_SIZE;
  for (let i = 0; i < plane; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    chw[i] = (r - MEAN[0]) / STD[0];
    chw[plane + i] = (g - MEAN[1]) / STD[1];
    chw[2 * plane + i] = (b - MEAN[2]) / STD[2];
  }
  return new ort.Tensor('float32', chw, [1, 3, IMG_SIZE, IMG_SIZE]);
}

export async function runStage3PriceEstimation(
  canvas: HTMLCanvasElement,
  card: ScryfallCardFields,
): Promise<Stage3Status> {
  try {
    const [embedderSession, priceSession, scaler] = await Promise.all([
      getEmbedderSession(),
      getPriceSession(),
      getScaler(),
    ]);
    if (!embedderSession || !priceSession) return { status: 'unavailable' };
    if (!scaler) {
      return {
        status: 'error',
        message: `No se pudo cargar ${STAGE3_SCALER_URL} — ver el aviso en stage3PriceEstimator.ts sobre publicar el escalador real.`,
      };
    }

    const ort: OrtModule = await import('onnxruntime-web');

    const imageTensor = preprocess(canvas, ort);
    const embedderInput = embedderSession.inputNames[0];
    const embedderOutput = embedderSession.outputNames[0];
    const embedderResults = await embedderSession.run({ [embedderInput]: imageTensor });
    const visual = embedderResults[embedderOutput].data as ArrayLike<number>;
    if (visual.length !== VISUAL_EMBEDDING_DIM) {
      throw new Error(`Embedding visual con forma inesperada: ${visual.length} (se esperaban ${VISUAL_EMBEDDING_DIM})`);
    }

    const rawTabular = buildTabularVector(card);
    const tabular = escalarNumericos(rawTabular, scaler);

    const features = new Float32Array(N_TAB_FEATURES + VISUAL_EMBEDDING_DIM);
    features.set(tabular, 0);
    features.set(visual, N_TAB_FEATURES);

    const inputTensor = new ort.Tensor('float32', features, [1, features.length]);
    const priceInput = priceSession.inputNames[0];
    const priceOutput = priceSession.outputNames[0];
    const priceResults = await priceSession.run({ [priceInput]: inputTensor });
    const priceLog1p = (priceResults[priceOutput].data as ArrayLike<number>)[0];
    const priceUsd = Math.expm1(priceLog1p);

    return { status: 'ok', result: { priceUsd } };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
