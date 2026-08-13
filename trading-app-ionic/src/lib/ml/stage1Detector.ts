/**
 * Stage 1 (MTG / no-MTG binary detector) client-side inference, via
 * `onnxruntime-web`. Scope is deliberately narrow: this file only runs
 * Stage 1. Stage 2 (OCR/text validation, future `tesseract.js`) and Stage 3
 * (price regression — no backend endpoint exists anywhere yet) are NOT
 * wired here on purpose; see Proyecto/examen/README.md and
 * Proyecto/certamen_2/README.md for the full 3-stage pipeline plan.
 *
 * NO TRAINED MODEL FILE SHIPS IN THIS REPO YET. `Proyecto/certamen_1/pytorch/
 * 09_export_onnx.py` exists but has not been run to produce an artifact in
 * this repo's history, and TensorFlow has no export script at all yet (see
 * root README.md "Próximos pasos"). This module is written to degrade
 * gracefully when the model file is missing (`{ status: 'unavailable' }`)
 * rather than throw — the UI (Tab2.tsx) shows "modelo no disponible
 * todavía" instead of crashing.
 *
 * To plug in a real model once it's exported:
 *   1. Run the export script for whichever framework won Stage 1 (see
 *      Proyecto/certamen_2/README.md §"selección del modelo ganador").
 *   2. Drop the resulting .onnx file at
 *      trading-app-ionic/public/models/stage1-detector.onnx (or point
 *      VITE_STAGE1_MODEL_URL at wherever it's hosted).
 *   3. Double-check IMG_SIZE/MEAN/STD/interpretOutput() below actually match
 *      the export script's preprocessing + output shape — they're
 *      placeholder assumptions (224x224, ImageNet normalization, either a
 *      single sigmoid output or a 2-class softmax) until verified against
 *      the real exported graph.
 */

// Lazily imported inside getSession()/preprocess() so onnxruntime-web (and
// its wasm runtime) is only pulled into the bundle when Tab2 actually tries
// to run a detection, not on initial app load.
type OrtModule = typeof import('onnxruntime-web');

const STAGE1_MODEL_URL: string =
  (import.meta.env.VITE_STAGE1_MODEL_URL as string | undefined) ?? '/models/stage1-detector.onnx';

// Placeholder preprocessing contract — see file header. Adjust if it
// doesn't match the real export.
const IMG_SIZE = 224;
const MEAN = [0.485, 0.456, 0.406] as const; // ImageNet defaults (torchvision convention)
const STD = [0.229, 0.224, 0.225] as const;

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

/** Resizes the captured frame to IMG_SIZE×IMG_SIZE and normalizes to an NCHW Float32Array. */
function preprocess(canvas: HTMLCanvasElement, ort: OrtModule): InstanceType<OrtModule['Tensor']> {
  const resized = document.createElement('canvas');
  resized.width = IMG_SIZE;
  resized.height = IMG_SIZE;
  const ctx = resized.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.drawImage(canvas, 0, 0, IMG_SIZE, IMG_SIZE);

  const { data } = ctx.getImageData(0, 0, IMG_SIZE, IMG_SIZE); // RGBA, HWC, 0..255
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
