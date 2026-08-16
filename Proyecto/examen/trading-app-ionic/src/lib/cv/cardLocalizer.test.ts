// @vitest-environment node
//
// Real @techstark/opencv-js WASM init hangs indefinitely under jsdom (its
// Emscripten runtime bootstrap seems to detect jsdom's fake `document`/
// `window` and take a browser init path that jsdom can't actually service —
// reproduced directly: `await import('@techstark/opencv-js')`'s inner
// Promise never settles under `environment: 'jsdom'`, times out; the exact
// same code resolves in <1s under `environment: 'node'` or plain Node).
// This file doesn't touch any DOM API (cardLocalizer.ts's functions all
// take an already-built `cv.Mat`, no canvas/video involved), so overriding
// to `node` for just this file costs nothing and sidesteps the hang.

/**
 * ROADMAP.md G4c — unit tests for cardLocalizer.ts, against the REAL
 * `@techstark/opencv-js` WASM runtime (not mocked — unlike canvas, OpenCV.js
 * runs headless in Node/vitest exactly as it does in the browser, so there's
 * no jsdom gap to work around here).
 *
 * These synthetic fixtures cover the found/not-found branches with small,
 * self-contained images. The real accuracy claim — 122/122 (100%) on the
 * actual "Squirreled Away" real-photo test set, matching
 * `card_preprocessing.py`'s own measured figure exactly — was verified
 * separately (real photos are gitignored, 584MB, not committed as test
 * fixtures) and is recorded in ROADMAP.md's G4c row, not re-run here.
 */

import { describe, expect, it } from 'vitest';
import {
  ASPECT_RATIO_CARTA,
  getOpenCv,
  localizarCarta,
  matFromRgba,
  ordenarEsquinas,
  type OpenCvModule,
  type Point,
} from './cardLocalizer';

describe('ordenarEsquinas', () => {
  it('orders 4 arbitrary points as (top-left, top-right, bottom-right, bottom-left)', () => {
    const shuffled: Point[] = [
      { x: 100, y: 0 }, // top-right
      { x: 0, y: 100 }, // bottom-left
      { x: 0, y: 0 }, // top-left
      { x: 100, y: 100 }, // bottom-right
    ];
    const [tl, tr, br, bl] = ordenarEsquinas(shuffled);
    expect(tl).toEqual({ x: 0, y: 0 });
    expect(tr).toEqual({ x: 100, y: 0 });
    expect(br).toEqual({ x: 100, y: 100 });
    expect(bl).toEqual({ x: 0, y: 100 });
  });
});

/** Solid-color RGBA buffer, optionally with a filled rectangle of a second color. */
function makeImage(
  width: number,
  height: number,
  bg: [number, number, number],
  rect?: { x: number; y: number; w: number; h: number; color: [number, number, number] },
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = bg[0]; data[i * 4 + 1] = bg[1]; data[i * 4 + 2] = bg[2]; data[i * 4 + 3] = 255;
  }
  if (rect) {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const i = (y * width + x) * 4;
        data[i] = rect.color[0]; data[i + 1] = rect.color[1]; data[i + 2] = rect.color[2]; data[i + 3] = 255;
      }
    }
  }
  return data;
}

describe('localizarCarta (real @techstark/opencv-js)', () => {
  // First real getOpenCv() call in this file pays OpenCV.js's one-time WASM
  // boot cost (memoized after — the other tests below stay fast) — bump
  // past vitest's default 5000ms rather than the whole file's timeout.
  it('finds a light, low-saturation "card" rect on a saturated background', { timeout: 20000 }, async () => {
    const cv: OpenCvModule = await getOpenCv();
    const width = 400;
    const height = 400;
    // Saturated blue background, light-gray low-saturation "card" — same
    // contrast profile _mascara_saturacion() is designed for.
    const data = makeImage(width, height, [20, 20, 220], {
      x: 100, y: 60, w: 200, h: 280, color: [230, 225, 220], // 200/280 ≈ 0.714, close to ASPECT_RATIO_CARTA
    });
    const mat = matFromRgba(cv, data, width, height);
    let result;
    try {
      result = localizarCarta(cv, mat);
    } finally {
      mat.delete();
    }

    expect(result).not.toBeNull();
    expect(result!.score).toBeLessThan(0.05); // close to the ideal aspect ratio

    // Corners should roughly bound the drawn rect (a few px tolerance for
    // Otsu/contour/minAreaRect rounding, not pixel-exact).
    const xs = result!.corners.map((p) => p.x);
    const ys = result!.corners.map((p) => p.y);
    expect(Math.min(...xs)).toBeGreaterThan(90);
    expect(Math.max(...xs)).toBeLessThan(310);
    expect(Math.min(...ys)).toBeGreaterThan(50);
    expect(Math.max(...ys)).toBeLessThan(350);
  });

  it('returns null on a uniform image (nothing to localize)', async () => {
    const cv: OpenCvModule = await getOpenCv();
    const width = 200;
    const height = 200;
    const data = makeImage(width, height, [128, 128, 128]);
    const mat = matFromRgba(cv, data, width, height);
    let result;
    try {
      result = localizarCarta(cv, mat);
    } finally {
      mat.delete();
    }
    expect(result).toBeNull();
  });

  it('returns null when the candidate rect is too small (below AREA_MINIMA_FRACCION)', async () => {
    const cv: OpenCvModule = await getOpenCv();
    const width = 400;
    const height = 400;
    // Small rect (~2.5% of frame, well under the 15% floor), right aspect ratio otherwise.
    const data = makeImage(width, height, [20, 20, 220], {
      x: 180, y: 170, w: 40, h: 56, color: [230, 225, 220],
    });
    const mat = matFromRgba(cv, data, width, height);
    let result;
    try {
      result = localizarCarta(cv, mat);
    } finally {
      mat.delete();
    }
    expect(result).toBeNull();
  });

  it('returns null when the candidate rect has the wrong aspect ratio (square, not card-shaped)', async () => {
    const cv: OpenCvModule = await getOpenCv();
    const width = 400;
    const height = 400;
    const data = makeImage(width, height, [20, 20, 220], {
      x: 80, y: 80, w: 240, h: 240, color: [230, 225, 220], // ratio 1.0, ASPECT_RATIO_CARTA is ~0.716
    });
    const mat = matFromRgba(cv, data, width, height);
    let result;
    try {
      result = localizarCarta(cv, mat);
    } finally {
      mat.delete();
    }
    expect(result).toBeNull();
  });
});

describe('ASPECT_RATIO_CARTA', () => {
  it('matches the real MTG card ratio (63x88mm), same constant as card_preprocessing.py', () => {
    expect(ASPECT_RATIO_CARTA).toBeCloseTo(63 / 88, 10);
  });
});
