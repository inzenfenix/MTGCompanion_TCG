/**
 * Stage 2 (OCR-text vs. reference-text match) client-side inference, via
 * `onnxruntime-web` — same loading/session pattern as `stage1Detector.ts`.
 *
 * Unlike Stage 1/4 (raw image in, ONNX does all the feature extraction),
 * Stage 2's exported graph (`pytorch/16_export_onnx_text_validator.py` /
 * `tensorFlow/14_export_onnx_text_validator.py`) takes an already-vectorized
 * `features` input of shape `[batch, 2048]` — verified directly against the
 * model and against `pytorch/src/text_matcher.py` (ROADMAP.md workstream E,
 * E1). That 2048-dim vector is
 * `concat[v_ocr, v_ref, |v_ocr - v_ref|, v_ocr * v_ref]`, where `v_ocr`/
 * `v_ref` are each a 512-dim `HashingVectorizer` output — see
 * `hashingVectorizer.ts`, ported and verified bit-identical to sklearn's.
 * Output is `logit`, shape `[batch, 1]` (raw, needs a client-side sigmoid —
 * same as Stage 1's `interpretOutput`).
 *
 * This module only runs Stage 2 given two already-extracted strings
 * (`ocrText`, `refText`) — it does not do OCR itself. Feeding it a real
 * photo's OCR output at scan time is E3 (tesseract.js in the browser, not
 * built yet — see ROADMAP.md). `refText` should be built the same way the
 * training data was: `` `${card.name} ${card.oracleText ?? ''}` `` (mirrors
 * `texto_referencia()` in `certamen_2/text_validator_baseline.py`).
 */

import { hashingVectorize, HASHING_N_FEATURES } from './hashingVectorizer';

type OrtModule = typeof import('onnxruntime-web');

const STAGE2_MODEL_URL: string =
  (import.meta.env.VITE_STAGE2_MODEL_URL as string | undefined) ?? '/models/stage2-text-validator.onnx';

// Youden-optimal decision threshold isn't part of the ONNX graph (it lives
// in `text_matcher_cfg.json`, a training-time artifact, not shipped to
// Ionic) — 0.5 is the same placeholder default `stage1Detector.ts` uses for
// its own threshold-free output. Replace with the real `umbral_optimo` if/
// when that value gets exposed to the client (e.g. baked into a small JSON
// alongside the .onnx file).
const MATCH_THRESHOLD = 0.5;

export type Stage2Result = {
  isMatch: boolean;
  /** 0..1 confidence in `isMatch`. */
  confidence: number;
};

export type Stage2Status =
  | { status: 'unavailable' } // no model file at STAGE2_MODEL_URL
  | { status: 'error'; message: string }
  | { status: 'ok'; result: Stage2Result };

// Memoized across calls, same reasoning as stage1Detector.ts's sessionPromise.
let sessionPromise: Promise<import('onnxruntime-web').InferenceSession | null> | null = null;

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const head = await fetch(STAGE2_MODEL_URL, { method: 'HEAD' }).catch(() => null);
      if (!head || !head.ok) return null;

      const ort: OrtModule = await import('onnxruntime-web');
      return ort.InferenceSession.create(STAGE2_MODEL_URL);
    })();
  }
  return sessionPromise;
}

/** Builds the 2048-dim `concat[v_ocr, v_ref, |diff|, product]` input tensor for one pair. */
function buildFeatures(ocrText: string, refText: string, ort: OrtModule): InstanceType<OrtModule['Tensor']> {
  const vOcr = hashingVectorize(ocrText);
  const vRef = hashingVectorize(refText);

  const dim = HASHING_N_FEATURES;
  const features = new Float32Array(dim * 4);
  for (let i = 0; i < dim; i++) {
    features[i] = vOcr[i];
    features[dim + i] = vRef[i];
    features[2 * dim + i] = Math.abs(vOcr[i] - vRef[i]);
    features[3 * dim + i] = vOcr[i] * vRef[i];
  }

  return new ort.Tensor('float32', features, [1, dim * 4]);
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export async function runStage2Validation(ocrText: string, refText: string): Promise<Stage2Status> {
  try {
    const session = await getSession();
    if (!session) return { status: 'unavailable' };

    const ort: OrtModule = await import('onnxruntime-web');
    const inputTensor = buildFeatures(ocrText, refText, ort);
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    const results = await session.run({ [inputName]: inputTensor });
    const logit = (results[outputName].data as ArrayLike<number>)[0];
    const confidence = sigmoid(logit);

    return { status: 'ok', result: { isMatch: confidence >= MATCH_THRESHOLD, confidence } };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
