/**
 * ROADMAP.md G4c — OpenCV.js port of `certamen_2/card_preprocessing.py`'s
 * `localizar_carta()`/`corregir_perspectiva()`. Same algorithm, not an
 * approximation: saturation-Otsu + brightness-Otsu candidate masks, largest
 * contour per mask scored by how close its aspect ratio is to a real MTG
 * card (0.18 tolerance), best-scoring candidate wins — see that module's
 * own docstring for why two independent segmentation strategies instead of
 * one (measured on the real 122-photo set: brightness alone 30.3%,
 * saturation alone 100%).
 *
 * Runs on `@techstark/opencv-js` (WASM), which works in both the browser
 * and Node — this module's own `.test.ts` verifies it against real photos
 * from `certamen_1/data/real_photos/`, the same ground-truth set
 * `card_preprocessing.py` was measured against (ROADMAP.md G4b).
 *
 * **Not ported** (same scope boundary G4c's own roadmap note already
 * drew): orientation correction (`orientation_fix.py` needs a real
 * tesseract binary, not portable to the browser) and CLAHE contrast
 * enhancement (`mejorar_contraste()`, no native canvas/OpenCV.js
 * equivalent worth the complexity here). The guide overlay in
 * `GuidedCapture.tsx` is the intended browser-side mitigation for
 * upside-down captures — the user aligns to the silhouette instead of the
 * software correcting it after the fact.
 *
 * **WASM memory discipline**: OpenCV.js `Mat`s are not garbage-collected —
 * every intermediate `Mat`/`MatVector` created here is `.delete()`d in a
 * `finally` block. This matters more here than in a one-shot script: this
 * module is meant to run in a ~150ms continuous loop (`GuidedCapture.tsx`),
 * so a leak would grow unbounded and eventually crash the tab.
 */

export type OpenCvModule = typeof import('@techstark/opencv-js');
export type Point = { x: number; y: number };
/** Ordered (top-left, top-right, bottom-right, bottom-left), matches `_ordenar_esquinas()`. */
export type Corners = [Point, Point, Point, Point];
export type LocalizationResult = { corners: Corners; score: number };

export const ASPECT_RATIO_CARTA = 63 / 88;
export const TOLERANCIA_ASPECT_RATIO = 0.18;
export const AREA_MINIMA_FRACCION = 0.15;
export const CANONICAL_WIDTH = 750;
export const CANONICAL_HEIGHT = 1050;

// Lazy dynamic import + module-level cache, same reasoning as every other
// heavy client-side runtime in this app (onnxruntime-web, tesseract.js).
// Follows the exact loading pattern @techstark/opencv-js's own README
// documents — cvModule can be a Promise, an already-ready module (Node), or
// a module still running its WASM init (`onRuntimeInitialized`).
let cvPromise: Promise<OpenCvModule> | null = null;

export async function getOpenCv(): Promise<OpenCvModule> {
  if (!cvPromise) {
    cvPromise = (async () => {
      const cvModule = await import('@techstark/opencv-js');
      const candidate = (cvModule as unknown as { default?: unknown }).default ?? cvModule;
      if (candidate instanceof Promise) return (await candidate) as OpenCvModule;
      if ((candidate as { Mat?: unknown }).Mat) return candidate as OpenCvModule;
      await new Promise<void>((resolve) => {
        (candidate as { onRuntimeInitialized?: () => void }).onRuntimeInitialized = () => resolve();
      });
      return candidate as OpenCvModule;
    })();
  }
  return cvPromise;
}

/** Builds a `cv.Mat` (CV_8UC4, RGBA) from a raw pixel buffer — portable between canvas ImageData (browser) and `sharp` output (Node verification). */
export function matFromRgba(cv: OpenCvModule, data: Uint8ClampedArray | Uint8Array, width: number, height: number) {
  return cv.matFromArray(height, width, cv.CV_8UC4, Array.from(data));
}

function morphOpenClose(cv: OpenCvModule, mask: InstanceType<OpenCvModule['Mat']>) {
  const kernelOpen = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(15, 15));
  const kernelClose = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(25, 25));
  try {
    cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kernelOpen);
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernelClose);
  } finally {
    kernelOpen.delete();
    kernelClose.delete();
  }
}

/** `_mascara_saturacion()` — inverted saturation-Otsu mask. Caller owns/deletes the returned Mat. */
export function mascaraSaturacion(cv: OpenCvModule, rgba: InstanceType<OpenCvModule['Mat']>) {
  const rgb = new cv.Mat();
  const hsv = new cv.Mat();
  const channels = new cv.MatVector();
  const sat = new cv.Mat();
  const blur = new cv.Mat();
  const mask = new cv.Mat();
  try {
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    cv.split(hsv, channels);
    channels.get(1).copyTo(sat);
    cv.GaussianBlur(sat, blur, new cv.Size(9, 9), 0);
    cv.threshold(blur, mask, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
    morphOpenClose(cv, mask);
    const result = new cv.Mat();
    mask.copyTo(result);
    return result;
  } finally {
    rgb.delete(); hsv.delete(); channels.delete(); sat.delete(); blur.delete(); mask.delete();
  }
}

/** `_mascara_brillo()` — brightness-Otsu mask. Caller owns/deletes the returned Mat. */
export function mascaraBrillo(cv: OpenCvModule, rgba: InstanceType<OpenCvModule['Mat']>) {
  const gray = new cv.Mat();
  const blur = new cv.Mat();
  const mask = new cv.Mat();
  try {
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(9, 9), 0);
    cv.threshold(blur, mask, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    morphOpenClose(cv, mask);
    const result = new cv.Mat();
    mask.copyTo(result);
    return result;
  } finally {
    gray.delete(); blur.delete(); mask.delete();
  }
}

type Candidate = { rect: InstanceType<OpenCvModule['RotatedRect']>; score: number };

/** `_mejor_candidato()` — largest contour in `mask` scored by aspect-ratio closeness, or null. Does NOT delete `mask` (caller's responsibility). */
export function mejorCandidato(cv: OpenCvModule, mask: InstanceType<OpenCvModule['Mat']>, areaImg: number): Candidate | null {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    if (contours.size() === 0) return null;

    let bestIdx = -1;
    let bestArea = -1;
    for (let i = 0; i < contours.size(); i++) {
      const area = cv.contourArea(contours.get(i));
      if (area > bestArea) { bestArea = area; bestIdx = i; }
    }
    if (bestIdx < 0 || bestArea < AREA_MINIMA_FRACCION * areaImg) return null;

    const rect = cv.minAreaRect(contours.get(bestIdx));
    const { width, height } = rect.size;
    if (width === 0 || height === 0) return null;

    const ratio = Math.min(width, height) / Math.max(width, height);
    const diff = Math.abs(ratio - ASPECT_RATIO_CARTA);
    if (diff > TOLERANCIA_ASPECT_RATIO) return null;

    return { rect, score: diff };
  } finally {
    contours.delete();
    hierarchy.delete();
  }
}

/** `_ordenar_esquinas()` — orders 4 points as (top-left, top-right, bottom-right, bottom-left). */
export function ordenarEsquinas(points: Point[]): Corners {
  const sums = points.map((p) => p.x + p.y);
  const diffs = points.map((p) => p.x - p.y);
  const tl = points[sums.indexOf(Math.min(...sums))];
  const br = points[sums.indexOf(Math.max(...sums))];
  const tr = points[diffs.indexOf(Math.max(...diffs))];
  const bl = points[diffs.indexOf(Math.min(...diffs))];
  return [tl, tr, br, bl];
}

/**
 * `localizar_carta()` — tries both segmentation strategies, keeps whichever
 * candidate's aspect ratio is closest to a real MTG card. Returns null if
 * neither strategy finds a confident rectangle. Caller does NOT need to
 * delete anything — this function owns and cleans up all its own Mats.
 */
export function localizarCarta(cv: OpenCvModule, rgba: InstanceType<OpenCvModule['Mat']>): LocalizationResult | null {
  const areaImg = rgba.rows * rgba.cols;
  const masks = [mascaraSaturacion(cv, rgba), mascaraBrillo(cv, rgba)];
  try {
    const candidates: Candidate[] = [];
    for (const mask of masks) {
      const candidate = mejorCandidato(cv, mask, areaImg);
      if (candidate) candidates.push(candidate);
    }
    if (candidates.length === 0) return null;

    const best = candidates.reduce((a, b) => (b.score < a.score ? b : a));
    const boxPoints = cv.boxPoints(best.rect);
    return { corners: ordenarEsquinas(boxPoints), score: best.score };
  } finally {
    masks.forEach((m) => m.delete());
  }
}

/** `corregir_perspectiva()` — warps `rgba` to the canonical card rect given 4 corners. Caller owns/deletes the returned Mat. */
export function corregirPerspectiva(
  cv: OpenCvModule,
  rgba: InstanceType<OpenCvModule['Mat']>,
  corners: Corners,
  width = CANONICAL_WIDTH,
  height = CANONICAL_HEIGHT,
) {
  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flatMap((p) => [p.x, p.y]));
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width - 1, 0, width - 1, height - 1, 0, height - 1]);
  const transform = cv.getPerspectiveTransform(srcTri, dstTri);
  const warped = new cv.Mat();
  try {
    cv.warpPerspective(rgba, warped, transform, new cv.Size(width, height));
    return warped;
  } finally {
    srcTri.delete(); dstTri.delete(); transform.delete();
  }
}
