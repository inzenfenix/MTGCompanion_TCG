/**
 * Stage 4 (condition grader — NM/LP/MP/HP/DMG) client-side inference, via
 * `onnxruntime-web`. Same `onnxruntime-web` loading pattern and image
 * preprocessing contract as `stage1Detector.ts` (224×224, ImageNet
 * normalization) — Stage 4's PyTorch export (`pytorch/12_export_onnx_condition.py`)
 * shares Stage 1's backbone/input shape, verified directly against the
 * exported graph (ROADMAP.md workstream E, E4): input `imagen`
 * `[batch, 3, 224, 224]` → output `logits` `[batch, 5]` (raw, needs a
 * client-side softmax, unlike Stage 1's binary sigmoid).
 *
 * Class order is `['NM', 'LP', 'MP', 'HP', 'DMG']` (index 0 = NM) — taken
 * straight from `12_export_onnx_condition.py`'s own run output, not
 * alphabetical or otherwise guessable, so it's a named constant here rather
 * than a bare array literal a future edit could silently reorder.
 *
 * PyTorch-only for now: the export script loads `condition_grader_combined.pth`
 * (real+synthetic checkpoint, see CLAUDE.md), not the plain
 * `condition_grader.pth` — that combined checkpoint is what actually
 * generalizes to real photos (72.2% vs. 38.7%, see CLAUDE.md). TensorFlow
 * has no combined-checkpoint equivalent yet (ROADMAP.md item C6), so there's
 * no `stage4-condition-grader` TF export to point this at even if a
 * `VITE_STAGE4_TF_MODEL_URL` variant were added later.
 */

type OrtModule = typeof import('onnxruntime-web');

const STAGE4_MODEL_URL: string =
  (import.meta.env.VITE_STAGE4_MODEL_URL as string | undefined) ?? '/models/stage4-condition-grader.onnx';

// Same preprocessing contract as stage1Detector.ts — see that file's header
// for why these are the assumed values (224x224, torchvision ImageNet
// normalization) until cross-checked against a real inference run.
const IMG_SIZE = 224;
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

/** Index 0 = NM — confirmed straight from the export script's own run output, not guessable. */
export const CONDITION_CLASSES = ['NM', 'LP', 'MP', 'HP', 'DMG'] as const;
export type ConditionClass = (typeof CONDITION_CLASSES)[number];

export type Stage4Result = {
  condition: ConditionClass;
  /** 0..1 confidence in `condition` (softmax probability). */
  confidence: number;
  /** Full probability distribution over CONDITION_CLASSES, same order. */
  probabilities: Record<ConditionClass, number>;
};

export type Stage4Status =
  | { status: 'unavailable' } // no model file at STAGE4_MODEL_URL
  | { status: 'error'; message: string }
  | { status: 'ok'; result: Stage4Result };

let sessionPromise: Promise<import('onnxruntime-web').InferenceSession | null> | null = null;

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const head = await fetch(STAGE4_MODEL_URL, { method: 'HEAD' }).catch(() => null);
      if (!head || !head.ok) return null;

      const ort: OrtModule = await import('onnxruntime-web');
      return ort.InferenceSession.create(STAGE4_MODEL_URL);
    })();
  }
  return sessionPromise;
}

/** Resizes the captured frame to IMG_SIZE×IMG_SIZE and normalizes to an NCHW Float32Array — same as stage1Detector.ts. */
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

function softmax(logits: ArrayLike<number>): number[] {
  const exps = Array.from(logits, Math.exp);
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

export async function runStage4ConditionGrading(canvas: HTMLCanvasElement): Promise<Stage4Status> {
  try {
    const session = await getSession();
    if (!session) return { status: 'unavailable' };

    const ort: OrtModule = await import('onnxruntime-web');
    const inputTensor = preprocess(canvas, ort);
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    const results = await session.run({ [inputName]: inputTensor });
    const probs = softmax(results[outputName].data as ArrayLike<number>);

    let bestIdx = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[bestIdx]) bestIdx = i;

    const probabilities = Object.fromEntries(
      CONDITION_CLASSES.map((c, i) => [c, probs[i]]),
    ) as Record<ConditionClass, number>;

    return {
      status: 'ok',
      result: { condition: CONDITION_CLASSES[bestIdx], confidence: probs[bestIdx], probabilities },
    };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
