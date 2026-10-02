/**
 * ROADMAP.md G4c/G4e — OpenCV.js port of `ml/data-prep/card_preprocessing.py`'s
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
 * from `ml/training/data/real_photos/`, the same ground-truth set
 * `card_preprocessing.py` was measured against (ROADMAP.md G4b).
 *
 * **Not ported**: orientation correction (`orientation_fix.py` needs a
 * real tesseract binary, not portable to the browser). The guide overlay in
 * `GuidedCapture.tsx` is the intended browser-side mitigation for
 * upside-down captures — the user aligns to the silhouette instead of the
 * software correcting it after the fact.
 *
 * `mejorar_contraste()`'s CLAHE (contrast-limited adaptive histogram
 * equalization) is **ported** — see `mejorarContraste()` below
 * (ROADMAP.md I27). This module's own earlier note said there was "no
 * native canvas/OpenCV.js equivalent worth the complexity here", which
 * turned out to be stale: OpenCV.js has already been loaded in the browser
 * since G4c, and its build genuinely exposes `cv.CLAHE` (confirmed live,
 * not assumed — `createCLAHE()`, the classic C++-style factory, is NOT
 * bound in this build, but `new cv.CLAHE(clipLimit, tileGridSize)` +
 * `.apply()` works). `ocrExtractor.ts::extractRegionText()` uses this
 * function too, since CLAHE is meant to run BEFORE the Otsu/grayscale step
 * that module already documents as "somewhat robust... just not as robust
 * as CLAHE+Otsu together".
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

// ROADMAP.md I19/I22/I23 — blur (motion or bad focus) degrades everything
// downstream of a capture, `identifyCard.ts`'s OCR worst of all (seen live
// this session: a blurry-but-otherwise-correctly-cropped capture still read
// garbage text even after the crop-geometry fix). Variance of the Laplacian
// is the standard sharpness heuristic (Pech-Pacheco et al.) — real photos
// have high-contrast edges (high variance after a 2nd-derivative filter),
// blur washes them out (low variance). Starting threshold, NOT measured
// against a real corpus of blurry on-device photos — smoke-tested against
// one real photo from tonight (sharp: 131.8) vs. the same photo Gaussian-
// blurred (sigma=2, mild: 6.3; sigma=6, heavy: 1.3) via the real
// `card_preprocessing.py::detectar_desenfoque()` this ports — 15 sits with
// real margin below a real sharp photo and above even a mild blur, but
// isn't tuned to this device/camera's real distribution. Revisit if real
// use shows it's too strict/loose.
export const DESENFOQUE_LAPLACIAN_VAR_MIN = 15;

// ROADMAP.md G4e, direction (a) — skin-tone rejection in the localizer
// itself (not just the downstream Stage 1 gate). Classic YCrCb skin range
// (Cr in [133,173], Cb in [77,127]) — chosen over an HSV range specifically
// because it separates chrominance from luminance, so it's reasonably
// lighting-robust. On its own this is NOT enough: measured directly against
// this project's real 122-photo set, a real "Sol Ring" photo's card
// candidate landed 66-72% inside this exact color band (a warm/gray card
// surface, not skin) — so a color-only filter would have wrongly rejected
// real cards (confirmed: 120/122 with color alone vs. 122/122 with the
// edge-density gate below). The second, REQUIRED signal is edge density
// (reusing the same Canny approach as `detectarFundaOpaca`): real card
// content (frame/text box/art/symbols) has real structural edges, a real
// skin/face surface doesn't — a candidate is only rejected as skin when
// BOTH the skin-color fraction is high AND the edge density is low.
export const YCRCB_PIEL_CR_MIN = 133;
export const YCRCB_PIEL_CR_MAX = 173;
export const YCRCB_PIEL_CB_MIN = 77;
export const YCRCB_PIEL_CB_MAX = 127;
export const UMBRAL_PIEL_FRACCION = 0.5;
export const PIEL_EDGE_FRACCION_MAX = 0.02;

// ROADMAP.md I32 — the localizer sometimes picks a large uniform background
// surface (e.g. a mousepad) instead of the card: `candidatosValidos()` used
// to score purely by area-min + aspect-ratio + skin, no notion of (a)
// whether a candidate touches the frame border, (b) whether it has real
// texture, or (c) whether its size is plausible. All three thresholds below
// were measured against the same real 122-photo set (`card_preprocessing.py`
// is the source of truth — see its own comments for the exact numbers), not
// guessed. Port faithfully, don't re-derive independently.
//
// `tocaBorde` is deliberately NOT a hard filter — 5/122 real WINNING
// candidates measure a slightly NEGATIVE margin (`cv.minAreaRect`'s rotated
// box can legitimately poke past the frame by rounding even on a correctly
// detected card, not only on a background surface) — a hard reject here
// would regress those 5 real detections, the same class of over-filtering
// `normalizarCarta`'s own Python docstring already warns against for the
// area/solidity/extent case. Instead it only adds `PENALIZACION_BORDE` to
// the score — deprioritizes a border-touching candidate when a better one
// exists, but still lets it win if it's the only candidate (better a
// slightly-misframed card than no candidate at all).
export const BORDE_MARGEN_FRACCION = 0.01; // 1% of frame width/height
export const PENALIZACION_BORDE = 0.5; // >> TOLERANCIA_ASPECT_RATIO (0.18) — always loses to a non-border candidate

// `texturaStd` IS a hard filter — real winning candidates in the 122-photo
// set measure grayscale std 41.5-59.6 within their rect, far above
// `FUNDA_OPACA_STD_MAX` (15, the already-validated "near-uniform color"
// threshold elsewhere in this file). 20 leaves >2x real margin below the
// observed minimum without approaching the existing "no content" threshold.
// Edge-density is NOT reused as an additional hard filter here (unlike the
// skin-rejection case above) — measured on the same dataset, the real
// winning candidate with the LOWEST edge density scores 0.0014, far below
// `FUNDA_OPACA_EDGE_FRACCION_MAX` (0.02); that threshold isn't transferable
// to this pre-perspective-correction context without a real false-reject
// risk, whereas std alone already separates the uniform-surface case safely.
export const CANDIDATO_TEXTURA_STD_MIN = 20;

// Simple hard cap — the real winning candidate with the LARGEST area in the
// 122-photo set measures 0.583 of the frame; 0.75 leaves ~30% real margin
// above that without risking a reject on a legitimately close-up capture.
export const AREA_MAXIMA_FRACCION = 0.75;

// Found live (ROADMAP.md I41): `mascaraSaturacion`/`mascaraBrillo` only
// keep LOW-saturation, plain-colored regions — exactly the opposite of a
// real card's art box (high-saturation, uneven brightness). On a close-up
// capture the art box's own height is wider than the gap the old FIXED
// 25px closing kernel could bridge, so the name/mana-cost bar (above the
// art) and the type-line/rules-text/border (below it) never merge into one
// mask blob — only the plain-colored bottom chunk survives as a clean
// contour, and it lands close enough to a real card's aspect ratio to pass
// `candidatosValidos()`'s filter ON ITS OWN, with no larger candidate
// around for `discardContained()` to prefer instead. Confirmed live: a real
// captured/warped photo showed exactly this — type line down to the
// bottom border, art and name entirely missing.
//
// A FIXED pixel kernel is also resolution-dependent in a way that made this
// worse specifically on the photo that matters most: `GuidedCapture.tsx`'s
// live tracking loop runs `localizarCarta` on a downscaled ~480px frame
// (`SAMPLE_MAX_SIDE`), but `doCapture()` — the actual saved/warped photo —
// runs it on the camera's native resolution, easily 4x+ larger. The same
// 25px kernel bridges a proportionally much SMALLER gap there. Scaling the
// kernel to the mask's own short side, not a fixed pixel count, fixes both
// problems together: consistent bridging power regardless of which frame
// size is being processed, and enough absolute bridging at any resolution
// to actually span a real card's art-box height.
//
// Fractions, not absolute pixels. OPEN kept at exactly the OLD fixed
// kernel's own ratio (15/400=0.0375, measured against
// `cardLocalizer.test.ts`'s synthetic trapezoid at its native 400px size,
// not the live app's 480px reference — shrinking it further measurably
// hurt corner precision on that same test, see below) — its job is small
// noise removal, no reason to change it. CLOSE is the one that needs real
// bridging power; empirically probed (not guessed) against that same
// trapezoid test across a range of values: anywhere from ~0.055 up plateaus
// at ~3.6px worst-corner error (comfortably under the test's existing 5px
// bound), so 0.08 buys real margin above the minimum that showed any
// improvement without spending precision it doesn't need to. Still only
// validated against one real repro (this session's screenshot) beyond that
// synthetic probe — AREA_MAXIMA_FRACCION/CANDIDATO_TEXTURA_STD_MIN below
// already guard against an over-merge swallowing the whole frame, so the
// downside of erring wide is bounded, not unbounded.
//
// ROADMAP.md I33 — DELIBERATELY diverges from `card_preprocessing.py`'s
// own OPEN/CLOSE fractions (0.02/0.04) despite this file's usual "same
// constants as the Python source of truth" convention. Tried copying
// Python's values here first — they broke this exact file's own trapezoid
// precision test right above (worst-corner error landed at exactly 5px,
// failing the `<5` bound). Root cause isn't a JS-port bug: Python's values
// were tuned against real standalone-camera-app photos at 3000-8000px
// (`real_negatives`/`real_photos`, see `localizer_eval.py` under
// ml/training/Testing), while THIS file's actual native operating range is
// 400-1920px (`GuidedCapture.tsx`'s live tracking + capture path, see the
// comment above) — a fraction-of-resolution kernel is inherently
// regime-dependent, so "same fraction" does NOT mean "same behavior" across
// a 10-20x resolution gap. Each side is tuned against real data for its own
// actual resolution range instead of forcing a literal constant match that
// would regress one side or the other — same algorithm design (fractional
// kernel scaling), different calibration per real operating regime.
export const OPEN_KERNEL_FRACCION = 0.0375;
export const CLOSE_KERNEL_FRACCION = 0.08;

// ROADMAP.md I28b — replaces I28's original `useDeviceTilt`/
// `DeviceOrientationEvent`-based approach entirely, per direct user
// feedback after trying it live: "too tight... what we should equalize is
// the angle of the card and the phone, if the card is at 45° so should the
// phone be — otherwise it's hard to hold that steady". Correct diagnosis:
// gravity-level was the wrong metric — what actually matters is whether the
// phone is PARALLEL to the card's plane, independent of that plane's
// absolute angle to the ground. That relative alignment is measurable
// directly from the image, no sensor needed: a rectangular card
// photographed exactly head-on always projects opposite sides of equal
// length, at ANY rotation — any keystone (opposite sides of different
// length) IS the phone-vs-card misalignment `useDeviceTilt` was trying to
// approximate indirectly and noisily via gravity. See `medirDesalineacion`.
//
// Threshold measured against the real 122-photo set (`localizarCarta()`
// post-I32), per axis separately: horizontal (top/bottom, "yaw"-style
// keystone) real 0.822-1.0; vertical (left/right, "pitch"-style keystone)
// real 0.909-1.0. 0.65 leaves real margin below BOTH axes' worst real case.
//
// Explicitly considered expressing this as a DEGREES threshold instead (the
// user's own ask: "something like 8-12 degrees on each axis") — measured
// and rejected: the naive ratio≈cos(angle) approximation would put even the
// BEST real photos in this set at ~35-49° of "apparent tilt", because at
// typical hand-held scanning distance the keystone is dominated by
// PROXIMITY perspective (the near edge of the card is objectively closer to
// the camera in absolute terms) rather than pure plane-tilt — a literal
// 8-12° cap under that formula would be STRICTER than what already works in
// practice, reintroducing the exact "too tight" problem this replaces. The
// ratio measured against real photos is the honest metric here, not a
// degree figure from a formula that doesn't hold at this capture distance.
export const DESALINEACION_RATIO_MIN = 0.65;

// Lazy load + module-level cache, same reasoning as every other heavy
// client-side runtime in this app (onnxruntime-web, tesseract.js).
let cvPromise: Promise<OpenCvModule> | null = null;

/**
 * `import('@techstark/opencv-js')`'s CJS export is itself a thenable
 * (documented in vite.config.ts's Vitest workaround comment) — that shape
 * breaks Rollup's dynamic-import CJS interop in the real production build:
 * `await import('@techstark/opencv-js')` throws `TypeError: Method
 * Promise.prototype.then called on incompatible receiver`, confirmed live
 * on a physical Android device (this was the actual cause of a permanent
 * "Loading vision..." hang, not slowness — see ROADMAP.md I15). Fixing the
 * downstream handling of the resolved value (duck-typing `.then` instead of
 * `instanceof Promise`) was NOT enough — the crash happens on the bare
 * `import()` itself, before any of that code even runs.
 *
 * Real fix: don't import it as an ES/CJS module at all in the browser.
 * `npm run setup:opencv` (scripts/setup-opencv-assets.mjs) copies the exact
 * same `dist/opencv.js` file to `public/opencv.js`, self-hosted same as
 * tesseract.js's assets (ROADMAP.md E3c) — loaded here as a classic
 * `<script>` tag, which sidesteps ES/CJS interop entirely (this is also how
 * OpenCV.js's own docs recommend loading it on a plain web page). `window.cv`
 * ends up being the exact same object shape `import()` would have resolved
 * to (Promise-like, or plain-with-onRuntimeInitialized, or already-ready) —
 * the duck-typing below still has to handle all three, same as before.
 *
 * Node (this module's own `.test.ts`, real WASM, not mocked) has no
 * `document` to inject a script tag into — kept on the `import()` path
 * there, which Node's plain ESM loader (not Rollup) handles fine, per the
 * same Vitest comment.
 */
function loadOpenCvGlobal(): Promise<unknown> {
  if (typeof document === 'undefined') {
    return import('@techstark/opencv-js').then((m) => (m as unknown as { default?: unknown }).default ?? m);
  }
  return new Promise((resolve, reject) => {
    const existing = (window as unknown as { cv?: unknown }).cv;
    if (existing) {
      resolve(existing);
      return;
    }
    const src = (import.meta.env.VITE_OPENCV_SCRIPT_URL as string | undefined) ?? '/opencv.js';
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve((window as unknown as { cv?: unknown }).cv);
    script.onerror = () => reject(new Error(`No se pudo cargar ${src} — corriste "npm run setup:opencv"?`));
    document.head.appendChild(script);
  });
}

export async function getOpenCv(): Promise<OpenCvModule> {
  if (!cvPromise) {
    cvPromise = (async () => {
      const candidate = await loadOpenCvGlobal();
      if ((candidate as { Mat?: unknown }).Mat) return candidate as OpenCvModule;
      // Duck-type on `.then`, not `instanceof Promise` — the object can be
      // a genuine Promise, a Promise-like proxy that fails the native
      // brand-check `instanceof` alone can't detect, or (Node path above)
      // an already-unwrapped module — see this function's own comment.
      // Promise.resolve() safely consumes ANY thenable through the spec's
      // own resolution procedure rather than invoking a possibly-fake
      // `.then` directly.
      if (typeof (candidate as { then?: unknown }).then === 'function') {
        return (await Promise.resolve(candidate)) as OpenCvModule;
      }
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

/** clipLimit/tileGridSize identical to `mejorar_contraste()`'s `cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))`. */
export const CLAHE_CLIP_LIMIT = 2.0;
export const CLAHE_TILE_GRID = 8;

/**
 * `mejorar_contraste()` — CLAHE (contrast-limited adaptive histogram
 * equalization) on the Lab luminance channel only, normalizing uneven
 * lighting without washing out color (ROADMAP.md I27). Faithful port, not
 * an approximation — same algorithm, same parameters. `cv.createCLAHE()`
 * (the classic C++-style factory `mejorar_contraste()`'s Python side uses)
 * is NOT bound in `@techstark/opencv-js`'s build (confirmed live, not
 * assumed) — `new cv.CLAHE(clipLimit, tileGridSize)` + `.apply()` is the
 * equivalent this build actually exposes. Caller owns/deletes the returned
 * Mat; does not mutate `rgba`.
 */
export function mejorarContraste(cv: OpenCvModule, rgba: InstanceType<OpenCvModule['Mat']>) {
  const rgb = new cv.Mat();
  const lab = new cv.Mat();
  const channels = new cv.MatVector();
  const lNorm = new cv.Mat();
  const merged = new cv.Mat();
  const result = new cv.Mat();
  const clahe = new cv.CLAHE(CLAHE_CLIP_LIMIT, new cv.Size(CLAHE_TILE_GRID, CLAHE_TILE_GRID));
  try {
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);
    cv.split(lab, channels);
    const l = channels.get(0);
    const a = channels.get(1);
    const b = channels.get(2);
    try {
      clahe.apply(l, lNorm);
      const outChannels = new cv.MatVector();
      outChannels.push_back(lNorm);
      outChannels.push_back(a);
      outChannels.push_back(b);
      try {
        cv.merge(outChannels, merged);
        cv.cvtColor(merged, rgb, cv.COLOR_Lab2RGB);
        cv.cvtColor(rgb, result, cv.COLOR_RGB2RGBA);
        const out = new cv.Mat();
        result.copyTo(out);
        return out;
      } finally {
        outChannels.delete();
      }
    } finally {
      l.delete(); a.delete(); b.delete();
    }
  } finally {
    rgb.delete(); lab.delete(); channels.delete(); lNorm.delete(); merged.delete(); result.delete();
    clahe.delete();
  }
}

function morphOpenClose(cv: OpenCvModule, mask: InstanceType<OpenCvModule['Mat']>) {
  // ROADMAP.md I41 — kernel size scales with the mask's own resolution
  // instead of a fixed pixel count; see OPEN_KERNEL_FRACCION/
  // CLOSE_KERNEL_FRACCION's own comment for why.
  const shortSide = Math.min(mask.rows, mask.cols);
  const openSize = Math.max(3, Math.round(shortSide * OPEN_KERNEL_FRACCION));
  const closeSize = Math.max(3, Math.round(shortSide * CLOSE_KERNEL_FRACCION));
  const kernelOpen = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(openSize, openSize));
  const kernelClose = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(closeSize, closeSize));
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

type Candidate = {
  rect: InstanceType<OpenCvModule['RotatedRect']>;
  score: number;
  area: number;
  /** Owned by the candidate until `localizarCarta` deletes it (all candidates', not just the winner's) in its `finally`. */
  contour: InstanceType<OpenCvModule['Mat']>;
};

/** `_mascara_piel()` — YCrCb skin-tone mask. Caller owns/deletes the returned Mat. */
function mascaraPiel(cv: OpenCvModule, rgba: InstanceType<OpenCvModule['Mat']>) {
  const rgb = new cv.Mat();
  const ycrcb = new cv.Mat();
  const mask = new cv.Mat();
  let lower: InstanceType<OpenCvModule['Mat']> | null = null;
  let upper: InstanceType<OpenCvModule['Mat']> | null = null;
  try {
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb, ycrcb, cv.COLOR_RGB2YCrCb);
    lower = new cv.Mat(ycrcb.rows, ycrcb.cols, ycrcb.type(), new cv.Scalar(0, YCRCB_PIEL_CR_MIN, YCRCB_PIEL_CB_MIN, 0));
    upper = new cv.Mat(ycrcb.rows, ycrcb.cols, ycrcb.type(), new cv.Scalar(255, YCRCB_PIEL_CR_MAX, YCRCB_PIEL_CB_MAX, 255));
    cv.inRange(ycrcb, lower, upper, mask);
    const result = new cv.Mat();
    mask.copyTo(result);
    return result;
  } finally {
    rgb.delete(); ycrcb.delete(); mask.delete();
    lower?.delete(); upper?.delete();
  }
}

/** `_mapa_bordes()` — same Canny edge map `detectarFundaOpaca` uses. Caller owns/deletes the returned Mat. */
function mapaBordes(cv: OpenCvModule, rgba: InstanceType<OpenCvModule['Mat']>) {
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  try {
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    cv.Canny(gray, edges, 50, 150);
    const result = new cv.Mat();
    edges.copyTo(result);
    return result;
  } finally {
    gray.delete(); edges.delete();
  }
}

/**
 * `_fraccion_en_rect()` — fraction of `rect`'s area that falls inside a
 * binary `mask` (255 = positive). Generic: used for both skin-color and
 * edge-density checks below. Rasterizes the rotated rect with `fillPoly`
 * rather than an axis-aligned bounding box, to not over/under-count on
 * rotated rects.
 */
function fraccionEnRect(cv: OpenCvModule, mask: InstanceType<OpenCvModule['Mat']>, rect: InstanceType<OpenCvModule['RotatedRect']>): number {
  const box = cv.boxPoints(rect);
  const boxMask = cv.Mat.zeros(mask.rows, mask.cols, cv.CV_8UC1);
  const intersection = new cv.Mat();
  const contour = cv.matFromArray(box.length, 1, cv.CV_32SC2, box.flatMap((p) => [Math.round(p.x), Math.round(p.y)]));
  const contours = new cv.MatVector();
  contours.push_back(contour);
  try {
    cv.fillPoly(boxMask, contours, new cv.Scalar(255));
    const rectArea = cv.countNonZero(boxMask);
    if (rectArea === 0) return 0;
    cv.bitwise_and(mask, boxMask, intersection);
    return cv.countNonZero(intersection) / rectArea;
  } finally {
    boxMask.delete(); intersection.delete(); contour.delete(); contours.delete();
  }
}

/**
 * `_toca_borde()` — true if any corner of `rect` falls within (or past)
 * `BORDE_MARGEN_FRACCION` of the image border. See that constant's own
 * comment for why this is a scoring deprioritization, not a hard filter
 * (ROADMAP.md I32).
 */
function tocaBorde(cv: OpenCvModule, rect: InstanceType<OpenCvModule['RotatedRect']>, anchoImg: number, altoImg: number): boolean {
  const box = cv.boxPoints(rect);
  const margenX = BORDE_MARGEN_FRACCION * anchoImg;
  const margenY = BORDE_MARGEN_FRACCION * altoImg;
  return box.some((p) => p.x <= margenX || p.x >= anchoImg - margenX || p.y <= margenY || p.y >= altoImg - margenY);
}

/**
 * `_std_en_rect()` — grayscale standard deviation within `rect`, same
 * principle as `detectarFundaOpaca` (ROADMAP.md G4f) but applied to a
 * candidate BEFORE cropping/warping, to reject uniform background surfaces
 * (e.g. a mousepad) at candidate-SELECTION time, not just as a post-capture
 * guard (ROADMAP.md I32).
 */
function stdEnRect(cv: OpenCvModule, gray: InstanceType<OpenCvModule['Mat']>, rect: InstanceType<OpenCvModule['RotatedRect']>): number {
  const box = cv.boxPoints(rect);
  const boxMask = cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8UC1);
  const contour = cv.matFromArray(box.length, 1, cv.CV_32SC2, box.flatMap((p) => [Math.round(p.x), Math.round(p.y)]));
  const contours = new cv.MatVector();
  contours.push_back(contour);
  const mean = new cv.Mat();
  const stddev = new cv.Mat();
  try {
    cv.fillPoly(boxMask, contours, new cv.Scalar(255));
    cv.meanStdDev(gray, mean, stddev, boxMask);
    return stddev.data64F[0];
  } finally {
    boxMask.delete(); contour.delete(); contours.delete(); mean.delete(); stddev.delete();
  }
}

/**
 * `_candidatos_validos()` — every contour in `mask` (not just the largest)
 * that passes the area/aspect-ratio filters. Evaluating all of them, not
 * only the biggest, is what lets `discardContained()` below catch "the
 * mask's largest contour is actually a sub-region inside the real card" —
 * with a single candidate per mask there's nothing to compare it against.
 *
 * `skinMask`/`edgeMap` (ROADMAP.md G4e, direction (a)) are optional — when
 * both are given, a candidate is discarded here only when it's MOSTLY
 * skin-toned (`UMBRAL_PIEL_FRACCION`) AND has low edge density
 * (`PIEL_EDGE_FRACCION_MAX`) — see those constants' own comments for why
 * BOTH are required (color alone false-positives on real, warm-toned
 * cards).
 *
 * `gray` (ROADMAP.md I32) is optional — when given, a candidate whose area
 * exceeds `AREA_MAXIMA_FRACCION` or whose `stdEnRect` falls below
 * `CANDIDATO_TEXTURA_STD_MIN` is discarded here (too large or too uniform a
 * region to plausibly be a held card — see those constants' own comments
 * for the real numbers behind them). A candidate that merely touches the
 * frame border gets `PENALIZACION_BORDE` added to its score instead of
 * being discarded (see that constant's own comment for why).
 *
 * Does NOT delete `mask`/`skinMask`/`edgeMap`/`gray` (caller's responsibility).
 */
function candidatosValidos(
  cv: OpenCvModule,
  mask: InstanceType<OpenCvModule['Mat']>,
  areaImg: number,
  skinMask?: InstanceType<OpenCvModule['Mat']>,
  edgeMap?: InstanceType<OpenCvModule['Mat']>,
  gray?: InstanceType<OpenCvModule['Mat']>,
): Candidate[] {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const anchoImg = mask.cols;
    const altoImg = mask.rows;
    const candidates: Candidate[] = [];
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      if (area < AREA_MINIMA_FRACCION * areaImg) continue;
      if (area > AREA_MAXIMA_FRACCION * areaImg) continue;

      const rect = cv.minAreaRect(contour);
      const { width, height } = rect.size;
      if (width === 0 || height === 0) continue;

      const ratio = Math.min(width, height) / Math.max(width, height);
      const diff = Math.abs(ratio - ASPECT_RATIO_CARTA);
      if (diff > TOLERANCIA_ASPECT_RATIO) continue;

      if (skinMask && edgeMap) {
        const skinFraction = fraccionEnRect(cv, skinMask, rect);
        if (skinFraction >= UMBRAL_PIEL_FRACCION) {
          const edgeFraction = fraccionEnRect(cv, edgeMap, rect);
          if (edgeFraction < PIEL_EDGE_FRACCION_MAX) continue;
        }
      }

      if (gray && stdEnRect(cv, gray, rect) < CANDIDATO_TEXTURA_STD_MIN) continue;

      const score = diff + (tocaBorde(cv, rect, anchoImg, altoImg) ? PENALIZACION_BORDE : 0);
      candidates.push({ rect, score, area, contour });
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

/**
 * `_esquinas_desde_contorno()` — finds the winning candidate's REAL 4
 * corners via `approxPolyDP`, allowing a general quadrilateral rather than
 * forcing a rectangle. Real angled photo (the norm for a phone scanner, not
 * the exception) projects a card as a TRAPEZOID (parallel edges converge
 * slightly under perspective), not a simply-rotated rectangle —
 * `cv.minAreaRect` (what `localizarCarta` used for the final corners until
 * now) can only ever return a rectangle, so `corregirPerspectiva` (a real
 * 4-point transform, capable of undistorting an actual trapezoid) was being
 * fed the wrong-shaped corners even when the rectangle itself was a good
 * area/aspect-ratio fit. Found live this session (ROADMAP.md I19/I25):
 * hand-held, angled captures came out of the "canonical" warp with visible
 * residual tilt, which broke `CROP_NOMBRE`/OCR downstream even after that
 * crop's own geometry was already fixed. Validated against a synthetic
 * trapezoid via the real Python port (`card_preprocessing.py`'s
 * `_esquinas_desde_contorno`): corners within ~1px of the true trapezoid's,
 * vs. up to ~20px off with the old `minAreaRect`-only corners on the same
 * input (400x400 test image) — a real, measured improvement, not just a
 * theoretical one. Falls back to `cv.boxPoints(rect)` (the old behavior) if
 * the contour doesn't reduce cleanly to 4 points — noisy/partially-occluded
 * shapes (e.g. fingers covering a card edge) where a clean quadrilateral
 * fit isn't reliable and the rectangle is still the best available guess.
 */
function esquinasDesdeContorno(
  cv: OpenCvModule,
  contour: InstanceType<OpenCvModule['Mat']>,
  rect: InstanceType<OpenCvModule['RotatedRect']>,
): Point[] {
  const approx = new cv.Mat();
  try {
    const perimeter = cv.arcLength(contour, true);
    cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);
    if (approx.rows === 4) {
      const points: Point[] = [];
      for (let i = 0; i < 4; i++) {
        points.push({ x: approx.data32S[i * 2], y: approx.data32S[i * 2 + 1] });
      }
      return points;
    }
    return cv.boxPoints(rect);
  } finally {
    approx.delete();
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

export type AlignmentResult = { misaligned: boolean; horizontalRatio: number; verticalRatio: number };

/**
 * `medir_desalineacion()` — measures how PARALLEL the phone is to the
 * card's plane, PER AXIS (ROADMAP.md I28b — see `DESALINEACION_RATIO_MIN`'s
 * own comment for why this replaces the gravity-based approach, and why two
 * independent axes rather than one combined ratio). `corners` must already
 * be ordered (tl, tr, br, bl) — same shape `localizarCarta` returns.
 * `misaligned` is true if EITHER axis falls below `threshold` — one badly
 * misaligned axis is already a real signal, both don't need to be bad.
 */
export function medirDesalineacion(corners: Corners, threshold = DESALINEACION_RATIO_MIN): AlignmentResult {
  const [tl, tr, br, bl] = corners;
  const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
  const top = dist(tl, tr);
  const bottom = dist(bl, br);
  const left = dist(tl, bl);
  const right = dist(tr, br);
  const horizontalRatio = Math.max(top, bottom) > 0 ? Math.min(top, bottom) / Math.max(top, bottom) : 0;
  const verticalRatio = Math.max(left, right) > 0 ? Math.min(left, right) / Math.max(left, right) : 0;
  return {
    misaligned: horizontalRatio < threshold || verticalRatio < threshold,
    horizontalRatio,
    verticalRatio,
  };
}

/**
 * `localizar_carta()` — tries both segmentation strategies, collects every
 * contour from each that passes the area/aspect-ratio/skin/texture/size
 * filter (`candidatosValidos`, G4e direction (a) + I32), discards any
 * contained inside a larger candidate (`discardContained`, G4e direction
 * (b)), then keeps the lowest-scoring survivor (aspect-ratio closeness,
 * plus I32's border penalty). Returns null if nothing survives. Caller does
 * NOT need to delete anything — this function owns and cleans up all its
 * own Mats.
 */
export function localizarCarta(cv: OpenCvModule, rgba: InstanceType<OpenCvModule['Mat']>): LocalizationResult | null {
  const areaImg = rgba.rows * rgba.cols;
  const masks = [mascaraSaturacion(cv, rgba), mascaraBrillo(cv, rgba)];
  const skinMask = mascaraPiel(cv, rgba);
  const edgeMap = mapaBordes(cv, rgba);
  const gray = new cv.Mat();
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
  let candidates: Candidate[] = [];
  try {
    candidates = discardContained(
      cv,
      masks.flatMap((mask) => candidatosValidos(cv, mask, areaImg, skinMask, edgeMap, gray)),
    );
    if (candidates.length === 0) return null;

    const best = candidates.reduce((a, b) => (b.score < a.score ? b : a));
    const corners = esquinasDesdeContorno(cv, best.contour, best.rect);
    return { corners: ordenarEsquinas(corners), score: best.score };
  } finally {
    masks.forEach((m) => m.delete());
    skinMask.delete();
    edgeMap.delete();
    gray.delete();
    candidates.forEach((c) => c.contour.delete());
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

export type BlurResult = { isBlurry: boolean; variance: number };

/**
 * `detectar_desenfoque()` — variance-of-Laplacian sharpness check. Meant to
 * run on the already-warped canonical card, same spot as
 * `detectarBrilloEspecular`, and BEFORE it too (no point checking for glare
 * on data that's already unusably blurry). See the Python docstring/the
 * constant's own comment for the real (if rough) calibration behind the
 * threshold.
 */
export function detectarDesenfoque(
  cv: OpenCvModule,
  rgba: InstanceType<OpenCvModule['Mat']>,
  varMin = DESENFOQUE_LAPLACIAN_VAR_MIN,
): BlurResult {
  const gray = new cv.Mat();
  const lap = new cv.Mat();
  const mean = new cv.Mat();
  const stddev = new cv.Mat();
  try {
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    cv.Laplacian(gray, lap, cv.CV_64F);
    cv.meanStdDev(lap, mean, stddev);
    const std = stddev.data64F[0];
    const variance = std * std;
    return { isBlurry: variance < varMin, variance };
  } finally {
    gray.delete(); lap.delete(); mean.delete(); stddev.delete();
  }
}
