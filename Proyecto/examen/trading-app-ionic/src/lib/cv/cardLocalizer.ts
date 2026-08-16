/**
 * ROADMAP.md G4c/G4e — OpenCV.js port of `certamen_2/card_preprocessing.py`'s
 * `localizar_carta()`/`corregir_perspectiva()`. Same algorithm, not an
 * approximation: saturation-Otsu + brightness-Otsu candidate masks, every
 * contour per mask scored by how close its aspect ratio is to a real MTG
 * card (0.18 tolerance), any candidate contained inside a larger candidate
 * discarded (G4e — prefer the outermost qualifying contour, rules out
 * latching onto an interior text box/art panel), best-scoring survivor wins
 * — see that module's own docstring for why two independent segmentation
 * strategies instead of one (measured on the real 122-photo set: brightness
 * alone 30.3%, saturation alone 100%).
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

// Sleeve follow-up (ROADMAP.md G4e) — "specular highlight" threshold: very
// high value (near-white/blown-out) + very low saturation (near-colorless)
// at once is the classic signature of a light reflection off a glossy
// surface — exactly what a clear plastic sleeve adds that a bare (matte)
// card doesn't produce. NOT measured against real sleeved photos (the
// 122-photo G4b/G4c dataset has none) — reasonable starting thresholds, not
// tuned; see `detectar_brillo_especular()`'s docstring in card_preprocessing.py.
export const BRILLO_ESPECULAR_VALUE_MIN = 235; // 0-255, HSV V channel
export const BRILLO_ESPECULAR_SAT_MAX = 25; // 0-255, HSV S channel
export const BRILLO_ESPECULAR_FRACCION_AVISO = 0.03; // >= 3% of the card area -> flag it

// Sleeve follow-up, layer 3 — "no recognizable card content" guard: a real
// MTG card, even NM, always has strong structural edges (black frame, text
// box, art panel, mana symbols) and real color variation. An opaque sleeve
// back (or its colored back facing the camera) has neither — just a
// near-uniform color blob. Not a sleeve DETECTOR (can't tell "opaque
// sleeve" from "blurry/miscropped photo" with this alone) — the honest
// framing is "no card content to grade," whatever the cause. Validated (16
// ago) against the 122 real (unsleeved) photos from the G4b/G4c dataset via
// card_preprocessing.py::detectar_funda_opaca() — 0 false positives, wide
// margin (min edge fraction 0.034 vs. this 0.02 threshold, min std 41.3 vs.
// this 15 threshold).
export const FUNDA_OPACA_EDGE_FRACCION_MAX = 0.02;
export const FUNDA_OPACA_STD_MAX = 15;

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

type Candidate = { rect: InstanceType<OpenCvModule['RotatedRect']>; score: number; area: number };

/**
 * `_candidatos_validos()` — every contour in `mask` (not just the largest)
 * that passes the area/aspect-ratio filters. Evaluating all of them, not
 * only the biggest, is what lets `discardContained()` below catch "the
 * mask's largest contour is actually a sub-region inside the real card" —
 * with a single candidate per mask there's nothing to compare it against.
 * Does NOT delete `mask` (caller's responsibility).
 */
function candidatosValidos(cv: OpenCvModule, mask: InstanceType<OpenCvModule['Mat']>, areaImg: number): Candidate[] {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const candidates: Candidate[] = [];
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      if (area < AREA_MINIMA_FRACCION * areaImg) continue;

      const rect = cv.minAreaRect(contour);
      const { width, height } = rect.size;
      if (width === 0 || height === 0) continue;

      const ratio = Math.min(width, height) / Math.max(width, height);
      const diff = Math.abs(ratio - ASPECT_RATIO_CARTA);
      if (diff > TOLERANCIA_ASPECT_RATIO) continue;

      candidates.push({ rect, score: diff, area });
    }
    return candidates;
  } finally {
    contours.delete();
    hierarchy.delete();
  }
}

/** True if every corner of `inner` (`cv.boxPoints` output) falls inside (or on the border of) `outer`. */
function rectContained(cv: OpenCvModule, inner: Point[], outer: Point[]): boolean {
  const outerContour = cv.matFromArray(outer.length, 1, cv.CV_32FC2, outer.flatMap((p) => [p.x, p.y]));
  try {
    return inner.every((p) => cv.pointPolygonTest(outerContour, new cv.Point(p.x, p.y), false) >= 0);
  } finally {
    outerContour.delete();
  }
}

/**
 * `_descartar_contenidos()` — drops any candidate whose rect is fully
 * contained inside another, larger candidate (same mask or the other one) —
 * prefers the OUTERMOST qualifying contour instead of accepting any contour
 * that happens to pass the aspect-ratio filter. Targets the "an interior
 * text box or art panel coincidentally shares an MTG card's aspect ratio"
 * false positive (ROADMAP.md G4e) without reintroducing the area/solidity/
 * extent filters `card_preprocessing.py` already documents as tried and
 * rejected for the no-background-render case — this is a relationship
 * BETWEEN two candidates (geometric containment), not an intrinsic property
 * of a single contour, so it's a different mechanism.
 */
function discardContained(cv: OpenCvModule, candidates: Candidate[]): Candidate[] {
  return candidates.filter((candidate, i) => {
    const points = cv.boxPoints(candidate.rect);
    const contained = candidates.some((other, j) => {
      if (j === i || other.area <= candidate.area) return false;
      return rectContained(cv, points, cv.boxPoints(other.rect));
    });
    return !contained;
  });
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
 * `localizar_carta()` — tries both segmentation strategies, collects every
 * contour from each that passes the area/aspect-ratio filter
 * (`candidatosValidos`), discards any contained inside a larger candidate
 * (`discardContained`, G4e), then keeps whichever survivor's aspect ratio is
 * closest to a real MTG card. Returns null if nothing survives. Caller does
 * NOT need to delete anything — this function owns and cleans up all its
 * own Mats.
 */
export function localizarCarta(cv: OpenCvModule, rgba: InstanceType<OpenCvModule['Mat']>): LocalizationResult | null {
  const areaImg = rgba.rows * rgba.cols;
  const masks = [mascaraSaturacion(cv, rgba), mascaraBrillo(cv, rgba)];
  try {
    const candidates = discardContained(
      cv,
      masks.flatMap((mask) => candidatosValidos(cv, mask, areaImg)),
    );
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

export type GlareResult = { hasGlare: boolean; fraction: number };

/**
 * `detectar_brillo_especular()` — glare/specular-highlight detection. Meant
 * to run on the already-warped canonical card (`corregirPerspectiva`'s
 * output), not the raw background photo — see the Python docstring for the
 * full rationale. Same not-tuned-against-real-sleeved-photos caveat applies
 * here (see the constants above).
 */
export function detectarBrilloEspecular(
  cv: OpenCvModule,
  rgba: InstanceType<OpenCvModule['Mat']>,
  valueMin = BRILLO_ESPECULAR_VALUE_MIN,
  satMax = BRILLO_ESPECULAR_SAT_MAX,
  fraccionAviso = BRILLO_ESPECULAR_FRACCION_AVISO,
): GlareResult {
  const rgb = new cv.Mat();
  const hsv = new cv.Mat();
  const mask = new cv.Mat();
  let lower: InstanceType<OpenCvModule['Mat']> | null = null;
  let upper: InstanceType<OpenCvModule['Mat']> | null = null;
  try {
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    lower = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), new cv.Scalar(0, 0, valueMin, 0));
    upper = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), new cv.Scalar(179, satMax, 255, 255));
    cv.inRange(hsv, lower, upper, mask);
    const fraction = cv.countNonZero(mask) / (mask.rows * mask.cols);
    return { hasGlare: fraction >= fraccionAviso, fraction };
  } finally {
    rgb.delete(); hsv.delete(); mask.delete();
    lower?.delete(); upper?.delete();
  }
}

export type OpaqueSleeveResult = { suspicious: boolean; edgeFraction: number; std: number };

/**
 * `detectar_funda_opaca()` — "no recognizable card content" guard, meant to
 * run on the already-warped canonical card before Stage 4 grading. See the
 * Python docstring for the full rationale and the real-photo validation
 * (0 false positives on the 122-photo G4b/G4c set).
 */
export function detectarFundaOpaca(
  cv: OpenCvModule,
  rgba: InstanceType<OpenCvModule['Mat']>,
  edgeFraccionMax = FUNDA_OPACA_EDGE_FRACCION_MAX,
  stdMax = FUNDA_OPACA_STD_MAX,
): OpaqueSleeveResult {
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const mean = new cv.Mat();
  const stddev = new cv.Mat();
  try {
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    cv.Canny(gray, edges, 50, 150);
    const edgeFraction = cv.countNonZero(edges) / (edges.rows * edges.cols);
    cv.meanStdDev(gray, mean, stddev);
    const std = stddev.data64F[0];
    return { suspicious: edgeFraction < edgeFraccionMax && std < stdMax, edgeFraction, std };
  } finally {
    gray.delete(); edges.delete(); mean.delete(); stddev.delete();
  }
}
