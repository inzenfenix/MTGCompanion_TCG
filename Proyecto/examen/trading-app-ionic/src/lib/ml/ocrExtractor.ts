/**
 * ROADMAP.md E3 — browser-side OCR (`tesseract.js`) feeding Stage 2 at scan
 * time. Ports the text-region crop + binarize steps of
 * `certamen_2/text_validator_baseline.py::recortar_texto()` /
 * `card_preprocessing.py` to canvas, then runs `tesseract.js` on the result.
 * `stage2TextValidator.ts` (E1) already accepts `(ocrText, refText)` as two
 * plain strings — `extractCardText()` below produces the `ocrText` half.
 *
 * **Scope, stated plainly**: this ports the SIMPLER of `recortar_texto()`'s
 * two paths — `es_render_pre_recortado=True`, i.e. "the input already IS a
 * tightly-framed card, no background" (Scryfall renders, in the Python
 * script's own case). It does **not** port `card_preprocessing.py`'s
 * `localizar_carta()` (contour-based card detection in a photo with
 * background) or `orientation_fix.py` (upside-down/sideways correction) —
 * both are already scoped as future OpenCV.js work under ROADMAP.md G4c,
 * which this module is written to slot underneath once it lands (feed its
 * localized+oriented output through `extractCardText()` here instead of a
 * raw camera frame). Until G4c exists, calling this on `Tab2.tsx`'s raw
 * `camera.captureFrame()` (background included) will read badly — the same
 * accuracy hit ROADMAP.md G4b measured and fixed server-side (Python) for
 * the exact same class of input, not yet fixed client-side. Not wired into
 * any page here for that reason — see ROADMAP.md's newly-added E3b/G4c note.
 *
 * Also **not** ported: `mejorar_contraste()`'s CLAHE (contrast-limited
 * adaptive histogram equalization on the Lab luminance channel) — no native
 * canvas equivalent, and porting CLAHE correctly is its own nontrivial
 * algorithm. Skipped rather than faked; Otsu thresholding below is somewhat
 * robust to uneven lighting on its own (it's an adaptive per-image
 * threshold, not a fixed one), just not as robust as CLAHE+Otsu together.
 *
 * Pipeline here: resize input to the canonical MTG card ratio (750×1050,
 * same `ANCHO_CANONICO`/`ALTO_CANONICO` as `card_preprocessing.py`) → crop
 * the rules-text box (`CROP_TEXTO`, identical fractions to the Python
 * module) → 3x upscale → grayscale → Otsu threshold → `tesseract.js`.
 * `computeCropRect`/`toGrayscale`/`otsuThreshold`/`binarize` are pure
 * (no DOM), unit-tested directly; `extractCardText` is the DOM-facing glue
 * (canvas draw/crop/upscale, which jsdom can't actually render — see this
 * module's own `.test.ts` for how that's handled, same pattern as
 * `stage3PriceEstimator.ts`'s `preprocess()`).
 */

export const CANONICAL_WIDTH = 750;
export const CANONICAL_HEIGHT = 1050;
/** (x0, y0, x1, y1) as fractions of the canonical card size — identical to `CROP_TEXTO` in text_validator_baseline.py. */
export const CROP_TEXTO = [0.07, 0.52, 0.93, 0.88] as const;
/**
 * (x0, y0, x1, y1) fractions of the title bar, i.e. the card's name — no
 * Python precedent for this one (`card_preprocessing.py`/`text_validator_baseline.py`
 * only ever crop the rules-text box above), added for ROADMAP.md E3b's
 * scan-to-identify flow. Estimated from the standard modern (2015+) MTG
 * frame's title-bar proportions, right edge stops short of the mana-cost
 * symbols in the corner. Doesn't need to be pixel-exact — it only feeds a
 * fuzzy `GET /catalog/search?q=` lookup, not an exact match; Stage 2 (real
 * oracle-text comparison) is what actually confirms/ranks candidates
 * afterward, see `identifyCard.ts`.
 */
export const CROP_NOMBRE = [0.07, 0.03, 0.8, 0.09] as const;
export const OCR_UPSCALE = 3;

export type RgbaImage = { data: Uint8ClampedArray; width: number; height: number };
export type GrayImage = { data: Uint8ClampedArray; width: number; height: number };

/**
 * Pixel rect (in source-image pixels) of a crop box's fractions — defaults
 * to `CROP_TEXTO` (rules-text). Uses `Math.floor`, not `Math.round` —
 * matches Python's `int(x0 * w)` (truncation, not rounding) in
 * `text_validator_baseline.py::_recortar_caja_texto()` exactly.
 */
export function computeCropRect(
  width: number,
  height: number,
  box: readonly [number, number, number, number] = CROP_TEXTO,
): { x: number; y: number; width: number; height: number } {
  const [x0, y0, x1, y1] = box;
  const x = Math.floor(x0 * width);
  const y = Math.floor(y0 * height);
  return { x, y, width: Math.floor(x1 * width) - x, height: Math.floor(y1 * height) - y };
}

/** Same luma weights `cv2.cvtColor(..., COLOR_BGR2GRAY)` uses (ITU-R BT.601), applied to canvas's RGBA order. */
export function toGrayscale(img: RgbaImage): GrayImage {
  const { data, width, height } = img;
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    out[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return { data: out, width, height };
}

/**
 * Otsu's method — same algorithm `cv2.threshold(..., cv2.THRESH_OTSU)` runs
 * (maximize inter-class variance over all 256 candidate thresholds), so this
 * is a faithful port, not an approximation, unlike the grayscale/resize
 * steps around it. Returns the threshold in [0, 255].
 */
export function otsuThreshold(gray: Uint8ClampedArray): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;

  const total = gray.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];

  let sumB = 0;
  let weightB = 0;
  let maxVariance = -1;
  let threshold = 0;
  for (let t = 0; t < 256; t++) {
    weightB += hist[t];
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += t * hist[t];
    const meanB = sumB / weightB;
    const meanF = (sumAll - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) ** 2;
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }
  return threshold;
}

/** `cv2.THRESH_BINARY` convention: strictly-greater-than-threshold -> 255 (white), else 0 (black). */
export function binarize(gray: GrayImage, threshold: number): GrayImage {
  const out = new Uint8ClampedArray(gray.data.length);
  for (let i = 0; i < gray.data.length; i++) out[i] = gray.data[i] > threshold ? 255 : 0;
  return { data: out, width: gray.width, height: gray.height };
}

/** Grayscale + Otsu-binarize an already-cropped-and-upscaled RGBA buffer — pure, no DOM. */
export function preprocessForOcr(img: RgbaImage): GrayImage {
  const gray = toGrayscale(img);
  const threshold = otsuThreshold(gray.data);
  return binarize(gray, threshold);
}

// Lazy dynamic import + module-level cache, same reasoning as
// stage1Detector.ts/stage3PriceEstimator.ts's onnxruntime-web sessions —
// tesseract.js's WASM runtime is only pulled in once OCR is actually used.
//
// ROADMAP.md E3c — self-hosted, no CDN dependency at runtime anymore.
// `createWorker('eng')`'s browser defaults used to fetch the worker script
// AND the English language data from jsdelivr's CDN at first use (checked
// directly — tesseract.js/src/worker/browser/defaultOptions.js hardcodes
// `workerPath` to a jsdelivr URL; language data is fetched from tessdata's
// own CDN the same way) — not bundled into this app. Fixed by passing
// `workerPath`/`corePath`/`langPath` explicitly, pointing at
// `public/tesseract/`/`public/tessdata/`, populated by `npm run
// setup:tesseract` (`scripts/setup-tesseract-assets.mjs`) once — same
// "configurable URL, sane local default" pattern every `VITE_STAGE*_URL`
// already uses for its `.onnx` file. If that script was never run (assets
// missing on disk), tesseract.js's `fetch()` of these local paths just 404s
// instead of silently falling back to the CDN — the setup step is a real
// prerequisite for OCR to work at all now, not an optional optimization;
// documented in this project's README.
export const TESSERACT_WORKER_PATH =
  (import.meta.env.VITE_TESSERACT_WORKER_URL as string | undefined) ?? '/tesseract/worker.min.js';
export const TESSERACT_CORE_PATH =
  (import.meta.env.VITE_TESSERACT_CORE_PATH as string | undefined) ?? '/tesseract/core';
export const TESSERACT_LANG_PATH =
  (import.meta.env.VITE_TESSERACT_LANG_PATH as string | undefined) ?? '/tessdata';

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js').createWorker>>;
let workerPromise: Promise<TesseractWorker> | null = null;

async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      return createWorker('eng', undefined, {
        workerPath: TESSERACT_WORKER_PATH,
        corePath: TESSERACT_CORE_PATH,
        langPath: TESSERACT_LANG_PATH,
      });
    })();
  }
  return workerPromise;
}

/**
 * Shared crop→upscale→binarize→OCR glue for one box. `extractCardText`/
 * `extractCardName` below are thin wrappers over this with `CROP_TEXTO`/
 * `CROP_NOMBRE` respectively.
 */
async function extractRegionText(
  source: HTMLCanvasElement | HTMLImageElement,
  box: readonly [number, number, number, number],
): Promise<string> {
  const resized = document.createElement('canvas');
  resized.width = CANONICAL_WIDTH;
  resized.height = CANONICAL_HEIGHT;
  const resizedCtx = resized.getContext('2d');
  if (!resizedCtx) throw new Error('2D canvas context unavailable');
  resizedCtx.imageSmoothingEnabled = true;
  resizedCtx.imageSmoothingQuality = 'high';
  resizedCtx.drawImage(source, 0, 0, CANONICAL_WIDTH, CANONICAL_HEIGHT);

  const crop = computeCropRect(CANONICAL_WIDTH, CANONICAL_HEIGHT, box);
  const upscaled = document.createElement('canvas');
  upscaled.width = crop.width * OCR_UPSCALE;
  upscaled.height = crop.height * OCR_UPSCALE;
  const upscaledCtx = upscaled.getContext('2d');
  if (!upscaledCtx) throw new Error('2D canvas context unavailable');
  upscaledCtx.imageSmoothingEnabled = true;
  upscaledCtx.imageSmoothingQuality = 'high';
  upscaledCtx.drawImage(
    resized,
    crop.x, crop.y, crop.width, crop.height,
    0, 0, upscaled.width, upscaled.height,
  );

  const rgba = upscaledCtx.getImageData(0, 0, upscaled.width, upscaled.height);
  const bin = preprocessForOcr({ data: rgba.data, width: rgba.width, height: rgba.height });

  const outCtx = upscaledCtx;
  const outImageData = outCtx.createImageData(bin.width, bin.height);
  for (let i = 0, p = 0; p < bin.data.length; i += 4, p++) {
    outImageData.data[i] = bin.data[p];
    outImageData.data[i + 1] = bin.data[p];
    outImageData.data[i + 2] = bin.data[p];
    outImageData.data[i + 3] = 255;
  }
  outCtx.putImageData(outImageData, 0, 0);

  const worker = await getWorker();
  const { data } = await worker.recognize(upscaled);
  return data.text.trim();
}

/**
 * Extracts rules-text from a canvas assumed to already contain a
 * tightly-framed card (see this module's header for what "tightly-framed"
 * means and what's NOT handled yet). Returns the raw OCR string — feed it
 * directly as `ocrText` to `runStage2Validation()`.
 */
export function extractCardText(source: HTMLCanvasElement | HTMLImageElement): Promise<string> {
  return extractRegionText(source, CROP_TEXTO);
}

/**
 * Extracts the card's name from its title bar — see `CROP_NOMBRE`'s own
 * comment for why this box is approximate. Feed the result to
 * `GET /catalog/search?q=` as a fuzzy first pass; `identifyCard.ts` uses
 * Stage 2 against the rules text to actually rank/confirm candidates, so an
 * imperfect name read here doesn't need to be exact.
 */
export function extractCardName(source: HTMLCanvasElement | HTMLImageElement): Promise<string> {
  return extractRegionText(source, CROP_NOMBRE);
}
