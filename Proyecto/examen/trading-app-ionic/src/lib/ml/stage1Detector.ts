/**
 * Stage 1 (MTG / no-MTG binary detector) client-side inference, via
 * `onnxruntime-web`. Scope is deliberately narrow: this file only runs
 * Stage 1. Stage 2 (OCR/text validation, future `tesseract.js`) and Stage 3
 * (price regression — no backend endpoint exists anywhere yet) are NOT
 * wired here on purpose; see Proyecto/examen/README.md and
 * Proyecto/certamen_2/README.md for the full 3-stage pipeline plan.
 *
 * ROADMAP.md I37 — this file's header used to say "NO TRAINED MODEL FILE
 * SHIPS IN THIS REPO YET" and described `IMG_SIZE`/`MEAN`/`STD` as
 * "placeholder assumptions... until verified against the real exported
 * graph" — stale. A real model (`public/models/stage1-detector.onnx`) has
 * shipped for a while, but that verification never actually happened, and
 * the placeholder assumptions were WRONG: found live via a real
 * `onnxruntime-web` exception on-device (`OrtRun(): Got invalid dimensions
 * for input: imagen`), then confirmed directly by loading the real graph
 * with `onnx` (Python) — every single Stage 1 inference had been throwing
 * and silently falling open (any capture accepted, geometric localizer's
 * candidate treated as "yes, an MTG card") since this preprocessing was
 * written, not "occasionally wrong" but ALWAYS broken. Real facts about
 * the shipped graph (not assumptions):
 *   - Input `imagen`: `[batch, 224, 224, 3]` — **NHWC** (channels-LAST),
 *     not NCHW. This is a TensorFlow/Keras export (`tf2onnx`, per
 *     CLAUDE.md's own note on `tf2onnx.convert.from_keras()` — the "imagen"
 *     /"dense_1" names are Keras-generated, not PyTorch's), and Keras'
 *     native tensor layout is channels-last.
 *   - **No client-side normalization** — the graph's very first op
 *     (`.../MobileNetV3Small_1/rescaling_1/mul`) is a Keras `Rescaling`
 *     layer applied directly to raw `imagen` input, confirmed by walking
 *     the actual ONNX graph nodes. `07_binary_classifier.py` (TensorFlow)
 *     itself explains why: MobileNetV3's `preprocess_input` is a
 *     documented Keras no-op ("preprocessing... included in the model
 *     implementation") — the real rescaling is baked into the exported
 *     graph, not something the caller is supposed to do. Feed raw 0-255
 *     float32 values, not `/255` and not ImageNet mean/std.
 * If Stage 1 is ever re-exported from a different framework/architecture,
 * re-verify this against the new graph the same way — `onnx.load()` +
 * inspect `graph.input`/`graph.node`, don't re-guess.
 */

// Lazily imported inside getSession()/preprocess() so onnxruntime-web (and
// its wasm runtime) is only pulled into the bundle when Tab2 actually tries
// to run a detection, not on initial app load.
type OrtModule = typeof import('onnxruntime-web');

const STAGE1_MODEL_URL: string =
  (import.meta.env.VITE_STAGE1_MODEL_URL as string | undefined) ?? '/models/stage1-detector.onnx';

// Real preprocessing contract, verified against the actual shipped ONNX
// graph — see file header (ROADMAP.md I37). NHWC, raw 0-255, no mean/std.
const IMG_SIZE = 224;

export type Stage1Result = {
  isMtgCard: boolean;
  /** 0..1 confidence in `isMtgCard`. */
  confidence: number;
};

export type Stage1Status =
  | { status: 'unavailable' } // no model file at STAGE1_MODEL_URL
  | { status: 'error'; message: string }
  | { status: 'ok'; result: Stage1Result };

// Memoized across calls so we don't re-fetch/re-init the session on every
// button press. Resolves to `null` when the model file isn't there.
let sessionPromise: Promise<import('onnxruntime-web').InferenceSession | null> | null = null;

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      // Cheap existence check before paying for onnxruntime-web's wasm
      // init — avoids a noisy console error from InferenceSession.create()
      // on a 404 and lets us return a clean "unavailable" status instead.
      const head = await fetch(STAGE1_MODEL_URL, { method: 'HEAD' }).catch(() => null);
      if (!head || !head.ok) return null;

      const ort: OrtModule = await import('onnxruntime-web');
      return ort.InferenceSession.create(STAGE1_MODEL_URL);
    })();
  }
  return sessionPromise;
}

/**
 * Builds the model's real input tensor from raw RGBA pixels — NHWC, raw
 * 0-255 float32 (see file header, ROADMAP.md I37, for why: verified
 * directly against the shipped graph, not assumed). Pure/no DOM, so it's
 * unit-testable directly against the real ONNX model without needing an
 * `HTMLCanvasElement` in Node — see this module's own `.test.ts`.
 */
export function buildInputTensor(
  ort: OrtModule,
  rgba: Uint8ClampedArray | Uint8Array,
  size: number = IMG_SIZE,
): InstanceType<OrtModule['Tensor']> {
  // NHWC with 3 channels is the SAME per-pixel layout `getImageData` already
  // uses, minus the alpha channel — just RGBA -> RGB per pixel, in raster order.
  const hwc = new Float32Array(3 * size * size);
  const pixelCount = size * size;
  for (let i = 0; i < pixelCount; i++) {
    hwc[i * 3] = rgba[i * 4];
    hwc[i * 3 + 1] = rgba[i * 4 + 1];
    hwc[i * 3 + 2] = rgba[i * 4 + 2];
  }
  return new ort.Tensor('float32', hwc, [1, size, size, 3]);
}

/** Resizes the captured frame to IMG_SIZE×IMG_SIZE and builds the model's real input tensor. */
function preprocess(canvas: HTMLCanvasElement, ort: OrtModule): InstanceType<OrtModule['Tensor']> {
  const resized = document.createElement('canvas');
  resized.width = IMG_SIZE;
  resized.height = IMG_SIZE;
  const ctx = resized.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.drawImage(canvas, 0, 0, IMG_SIZE, IMG_SIZE);

  const { data } = ctx.getImageData(0, 0, IMG_SIZE, IMG_SIZE); // RGBA, HWC, 0..255
  return buildInputTensor(ort, data, IMG_SIZE);
}

/** Interprets either a single sigmoid output or a 2-class softmax as (isMtgCard, confidence). */
function interpretOutput(data: ArrayLike<number>): Stage1Result {
  if (data.length === 1) {
    const p = data[0];
    return { isMtgCard: p >= 0.5, confidence: p >= 0.5 ? p : 1 - p };
  }
  // Assume index 1 = "is MTG card" class, softmax over 2 logits.
  const exps = Array.from(data, Math.exp);
  const sum = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map((e) => e / sum);
  const isMtgCard = probs[1] >= probs[0];
  return { isMtgCard, confidence: isMtgCard ? probs[1] : probs[0] };
}

export async function runStage1Detection(canvas: HTMLCanvasElement): Promise<Stage1Status> {
  try {
    const session = await getSession();
    if (!session) return { status: 'unavailable' };

    const ort: OrtModule = await import('onnxruntime-web');
    const inputTensor = preprocess(canvas, ort);
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    const results = await session.run({ [inputName]: inputTensor });
    const output = results[outputName];
    const result = interpretOutput(output.data as ArrayLike<number>);
    return { status: 'ok', result };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
