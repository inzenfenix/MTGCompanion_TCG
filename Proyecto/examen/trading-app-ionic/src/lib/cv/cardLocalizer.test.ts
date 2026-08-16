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
  detectarBrilloEspecular,
  detectarFundaOpaca,
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

describe('localizarCarta — G4e containment fix', () => {
  it('prefers the outer card over an inner card-shaped sub-region (e.g. a text box)', { timeout: 20000 }, async () => {
    const cv: OpenCvModule = await getOpenCv();
    const width = 400;
    const height = 400;
    // Mirrors the real failure mode: the brightness mask sees the whole
    // (saturated-green, brighter-than-background) outer card as one merged
    // blob — inner and outer are both "bright" there, so no internal edge —
    // while the saturation mask sees ONLY the low-saturation white inner
    // rect as foreground (outer's saturation is deliberately close to the
    // background's, so it doesn't register as its own contour there). Both
    // rects independently pass the area/aspect-ratio filter; only the
    // larger, outer one should survive `discardContained`.
    const outer = { x: 60, y: 30, w: 260, h: 364 }; // 260/364 ≈ 0.714, area 59% of frame
    const innerW = 140;
    const innerH = 196; // ≈ 0.714, area 17% of frame — above AREA_MINIMA_FRACCION (15%) on its own
    const inner = {
      x: outer.x + Math.floor((outer.w - innerW) / 2),
      y: outer.y + Math.floor((outer.h - innerH) / 2),
      w: innerW,
      h: innerH,
    };
    // bg: saturated blue, dark under standard grayscale weights.
    // outer: saturated green, same saturation as bg but brighter (grayscale-wise).
    // inner: near-white, low saturation, brightest of all three.
    const buf = makeImage(width, height, [30, 30, 200], { ...outer, w: outer.w, h: outer.h, color: [30, 200, 30] });
    for (let y = inner.y; y < inner.y + inner.h; y++) {
      for (let x = inner.x; x < inner.x + inner.w; x++) {
        const i = (y * width + x) * 4;
        buf[i] = 230; buf[i + 1] = 225; buf[i + 2] = 220; buf[i + 3] = 255;
      }
    }
    const mat = matFromRgba(cv, buf, width, height);
    let result;
    try {
      result = localizarCarta(cv, mat);
    } finally {
      mat.delete();
    }

    expect(result).not.toBeNull();
    // Corners should bound the OUTER rect, not the inner sub-region.
    const xs = result!.corners.map((p) => p.x);
    const ys = result!.corners.map((p) => p.y);
    expect(Math.min(...xs)).toBeLessThan(outer.x + 15);
    expect(Math.max(...xs)).toBeGreaterThan(outer.x + outer.w - 15);
    expect(Math.min(...ys)).toBeLessThan(outer.y + 15);
    expect(Math.max(...ys)).toBeGreaterThan(outer.y + outer.h - 15);
  });
});

describe('localizarCarta — G4e skin-tone rejection (direction (a))', () => {
  it('rejects a uniform skin-tone rect (e.g. a face) that would otherwise match a card aspect ratio', async () => {
    const cv: OpenCvModule = await getOpenCv();
    const width = 400;
    const height = 400;
    // Same shape/aspect-ratio profile as the very first localizarCarta test
    // ("finds a light, low-saturation card rect..."), but filled with a
    // typical light/medium skin-tone RGB instead of a card-gray — this is
    // the exact class of false positive G4c's own writeup found empirically
    // (a synthetic skin-tone rectangle scoring as "FOUND").
    const data = makeImage(width, height, [20, 20, 220], {
      x: 100, y: 60, w: 200, h: 280, color: [200, 150, 120], // uniform skin tone, no internal structure
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

  it('does NOT reject a warm/skin-toned CARD that has real internal structure (regression guard)', { timeout: 20000 }, async () => {
    const cv: OpenCvModule = await getOpenCv();
    const width = 400;
    const height = 400;
    // Reproduces the real false-positive this filter almost shipped with:
    // a real photo of "Sol Ring" (warm/gray card body) measured 66-72%
    // inside the YCrCb skin band by color alone — the fix requires ALSO
    // checking edge density, which a real card (frame/text box/art) has
    // plenty of and a real skin surface doesn't. This fixture is the same
    // uniform skin-tone fill as the test above, but with a dark "frame"
    // block and a light "text box" drawn inside it, like a real card layout.
    const outer = { x: 100, y: 60, w: 200, h: 280 };
    const data = makeImage(width, height, [20, 20, 220], { ...outer, color: [200, 150, 120] });
    // Dark frame block near the top (simulates a title bar / border).
    for (let y = outer.y + 10; y < outer.y + 60; y++) {
      for (let x = outer.x + 10; x < outer.x + outer.w - 10; x++) {
        const i = (y * width + x) * 4;
        data[i] = 20; data[i + 1] = 20; data[i + 2] = 20;
      }
    }
    // Light text-box block with a few dark lines (simulates printed rules text).
    for (let y = outer.y + 180; y < outer.y + 260; y++) {
      for (let x = outer.x + 10; x < outer.x + outer.w - 10; x++) {
        const i = (y * width + x) * 4;
        data[i] = 235; data[i + 1] = 230; data[i + 2] = 220;
      }
    }
    for (let y = outer.y + 190; y < outer.y + 250; y += 8) {
      for (let x = outer.x + 20; x < outer.x + outer.w - 20; x++) {
        const i = (y * width + x) * 4;
        data[i] = 30; data[i + 1] = 30; data[i + 2] = 30;
      }
    }
    const mat = matFromRgba(cv, data, width, height);
    let result;
    try {
      result = localizarCarta(cv, mat);
    } finally {
      mat.delete();
    }
    expect(result).not.toBeNull();
  });
});

describe('detectarBrilloEspecular', () => {
  it('flags a large near-white, low-saturation blob (simulated sleeve glare)', async () => {
    const cv: OpenCvModule = await getOpenCv();
    const width = 300;
    const height = 300;
    // Printed card body: mid-gray with a little color, not a glare signature.
    const data = makeImage(width, height, [180, 170, 160], {
      x: 100, y: 100, w: 120, h: 120, color: [250, 250, 250], // blown-out white blob, ~16% of frame
    });
    const mat = matFromRgba(cv, data, width, height);
    let result;
    try {
      result = detectarBrilloEspecular(cv, mat);
    } finally {
      mat.delete();
    }
    expect(result.hasGlare).toBe(true);
    expect(result.fraction).toBeGreaterThan(0.03);
  });

  it('does not flag a card with no large blown-out region', async () => {
    const cv: OpenCvModule = await getOpenCv();
    const width = 300;
    const height = 300;
    const data = makeImage(width, height, [180, 170, 160]);
    const mat = matFromRgba(cv, data, width, height);
    let result;
    try {
      result = detectarBrilloEspecular(cv, mat);
    } finally {
      mat.delete();
    }
    expect(result.hasGlare).toBe(false);
  });
});

describe('detectarFundaOpaca', () => {
  it('flags a near-uniform color blob (simulated opaque sleeve back)', async () => {
    const cv: OpenCvModule = await getOpenCv();
    const width = 300;
    const height = 420;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      // Tiny per-pixel jitter, like real sensor noise, still far below the std threshold.
      const n = (i % 5) - 2;
      data[i * 4] = 60 + n; data[i * 4 + 1] = 40 + n; data[i * 4 + 2] = 180 + n; data[i * 4 + 3] = 255;
    }
    const mat = matFromRgba(cv, data, width, height);
    let result;
    try {
      result = detectarFundaOpaca(cv, mat);
    } finally {
      mat.delete();
    }
    expect(result.suspicious).toBe(true);
  });

  it('does not flag a card-like image with real structure (border + inner box + art block)', async () => {
    const cv: OpenCvModule = await getOpenCv();
    const width = 300;
    const height = 420;
    // Layered rects like a real card layout: white body, black frame, a
    // colored "art" block, a light "text box" — enough edges/variance that
    // this should read as real content, not a blank/uniform surface.
    const data = makeImage(width, height, [20, 20, 20]); // black frame
    for (let y = 10; y < height - 10; y++) {
      for (let x = 10; x < width - 10; x++) {
        const i = (y * width + x) * 4;
        data[i] = 235; data[i + 1] = 230; data[i + 2] = 220; // white body
      }
    }
    for (let y = 30; y < 220; y++) {
      for (let x = 20; x < width - 20; x++) {
        const i = (y * width + x) * 4;
        data[i] = 40; data[i + 1] = 110; data[i + 2] = 60; // green "art" block
      }
    }
    for (let y = 260; y < 380; y++) {
      for (let x = 20; x < width - 20; x++) {
        const i = (y * width + x) * 4;
        data[i] = 245; data[i + 1] = 245; data[i + 2] = 240; // light "text box"
      }
    }
    const mat = matFromRgba(cv, data, width, height);
    let result;
    try {
      result = detectarFundaOpaca(cv, mat);
    } finally {
      mat.delete();
    }
    expect(result.suspicious).toBe(false);
  });
});

describe('ASPECT_RATIO_CARTA', () => {
  it('matches the real MTG card ratio (63x88mm), same constant as card_preprocessing.py', () => {
    expect(ASPECT_RATIO_CARTA).toBeCloseTo(63 / 88, 10);
  });
});
