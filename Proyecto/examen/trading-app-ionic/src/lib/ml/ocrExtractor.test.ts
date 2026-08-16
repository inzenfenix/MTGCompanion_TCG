/**
 * ROADMAP.md E3 — unit tests for ocrExtractor.ts.
 *
 * `otsuThreshold`/`binarize`'s fixture is REAL `cv2.threshold(arr, 0, 255,
 * cv2.THRESH_BINARY + cv2.THRESH_OTSU)` output (a 10x10 synthetic bimodal
 * array, regenerated from a real OpenCV call this session) — same
 * "verified against the real Python function" method as
 * `hashingVectorizer.test.ts`'s sklearn fixtures, not a hand-derived
 * expectation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CANONICAL_HEIGHT,
  CANONICAL_WIDTH,
  CROP_NOMBRE,
  CROP_TEXTO,
  OCR_UPSCALE,
  binarize,
  computeCropRect,
  extractCardName,
  extractCardText,
  otsuThreshold,
  preprocessForOcr,
  toGrayscale,
} from './ocrExtractor';

describe('computeCropRect', () => {
  it('matches CROP_TEXTO fractions with Python-style truncation (Math.floor, not Math.round)', () => {
    const [x0, y0, x1, y1] = CROP_TEXTO;
    const rect = computeCropRect(CANONICAL_WIDTH, CANONICAL_HEIGHT);
    expect(rect.x).toBe(Math.floor(x0 * CANONICAL_WIDTH));
    expect(rect.y).toBe(Math.floor(y0 * CANONICAL_HEIGHT));
    expect(rect.width).toBe(Math.floor(x1 * CANONICAL_WIDTH) - Math.floor(x0 * CANONICAL_WIDTH));
    expect(rect.height).toBe(Math.floor(y1 * CANONICAL_HEIGHT) - Math.floor(y0 * CANONICAL_HEIGHT));
  });

  it('stays inside the source image bounds', () => {
    const rect = computeCropRect(CANONICAL_WIDTH, CANONICAL_HEIGHT);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(CANONICAL_WIDTH);
    expect(rect.y + rect.height).toBeLessThanOrEqual(CANONICAL_HEIGHT);
  });

  it('accepts a custom box (CROP_NOMBRE, the title bar used for scan-to-identify, ROADMAP.md E3b)', () => {
    const [x0, y0, x1, y1] = CROP_NOMBRE;
    const rect = computeCropRect(CANONICAL_WIDTH, CANONICAL_HEIGHT, CROP_NOMBRE);
    expect(rect.x).toBe(Math.floor(x0 * CANONICAL_WIDTH));
    expect(rect.y).toBe(Math.floor(y0 * CANONICAL_HEIGHT));
    expect(rect.width).toBe(Math.floor(x1 * CANONICAL_WIDTH) - Math.floor(x0 * CANONICAL_WIDTH));
    expect(rect.height).toBe(Math.floor(y1 * CANONICAL_HEIGHT) - Math.floor(y0 * CANONICAL_HEIGHT));
    // The title bar sits above the rules-text box and is much shorter.
    expect(rect.y).toBeLessThan(computeCropRect(CANONICAL_WIDTH, CANONICAL_HEIGHT, CROP_TEXTO).y);
  });
});

describe('toGrayscale', () => {
  it('applies ITU-R BT.601 luma weights (same as cv2.COLOR_BGR2GRAY)', () => {
    // Pure red, green, blue, white, black — 1x5 RGBA image.
    const data = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
    ]);
    const gray = toGrayscale({ data, width: 5, height: 1 });
    expect(Array.from(gray.data)).toEqual([
      Math.round(0.299 * 255),
      Math.round(0.587 * 255),
      Math.round(0.114 * 255),
      255,
      0,
    ]);
  });
});

// 10x10 grayscale array + real cv2.threshold(..., THRESH_BINARY | THRESH_OTSU)
// output for it — see this file's header.
const OTSU_FIXTURE_PIXELS = new Uint8ClampedArray([
  55, 199, 197, 192, 51, 168, 68, 69, 51, 184, 190, 59, 183, 170, 65, 200, 62, 74, 197, 58,
  61, 188, 53, 67, 164, 63, 60, 68, 182, 62, 196, 199, 175, 61, 71, 176, 81, 173, 53, 202,
  56, 64, 66, 184, 185, 56, 195, 49, 170, 62, 66, 196, 55, 201, 197, 60, 51, 188, 57, 50,
  72, 51, 200, 66, 198, 64, 164, 58, 55, 172, 51, 59, 62, 68, 56, 67, 64, 192, 192, 183,
  184, 51, 53, 69, 58, 65, 180, 40, 66, 183, 63, 184, 176, 46, 71, 45, 54, 67, 63, 187,
]);
const OTSU_FIXTURE_THRESHOLD = 81;
const OTSU_FIXTURE_BINARIZED = [
  0, 255, 255, 255, 0, 255, 0, 0, 0, 255, 255, 0, 255, 255, 0, 255, 0, 0, 255, 0,
  0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255,
  0, 0, 0, 255, 255, 0, 255, 0, 255, 0, 0, 255, 0, 255, 255, 0, 0, 255, 0, 0,
  0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255,
  255, 0, 0, 0, 0, 0, 255, 0, 0, 255, 0, 255, 255, 0, 0, 0, 0, 0, 0, 255,
];

describe('otsuThreshold', () => {
  it('matches real cv2.threshold(..., THRESH_OTSU) on a bimodal fixture', () => {
    expect(otsuThreshold(OTSU_FIXTURE_PIXELS)).toBe(OTSU_FIXTURE_THRESHOLD);
  });

  it('is deterministic', () => {
    const a = otsuThreshold(OTSU_FIXTURE_PIXELS);
    const b = otsuThreshold(OTSU_FIXTURE_PIXELS);
    expect(a).toBe(b);
  });
});

describe('binarize', () => {
  it('matches real cv2 THRESH_BINARY|THRESH_OTSU output exactly', () => {
    const gray = { data: OTSU_FIXTURE_PIXELS, width: 10, height: 10 };
    const result = binarize(gray, OTSU_FIXTURE_THRESHOLD);
    expect(Array.from(result.data)).toEqual(OTSU_FIXTURE_BINARIZED);
  });
});

describe('preprocessForOcr', () => {
  it('composes toGrayscale + otsuThreshold + binarize into a pure RGBA -> binary pipeline', () => {
    // 5x2 RGBA checkerboard, alternating clearly-dark / clearly-light pixels.
    const dark = [30, 30, 30, 255];
    const light = [220, 220, 220, 255];
    const data = new Uint8ClampedArray([...dark, ...light, ...dark, ...light, ...dark, ...light, ...dark, ...light, ...dark, ...light]);
    const result = preprocessForOcr({ data, width: 5, height: 2 });
    expect(result.width).toBe(5);
    expect(result.height).toBe(2);
    // Every dark input pixel -> 0, every light input pixel -> 255.
    expect(Array.from(result.data)).toEqual([0, 255, 0, 255, 0, 255, 0, 255, 0, 255]);
  });
});

// --- extractCardText: DOM-facing glue, mocked (jsdom has no real 2D canvas
// backend — see stage3PriceEstimator.test.ts's identical stubCanvasContext()
// pattern, which this mirrors). Verifies the crop/upscale math and canvas
// wiring are called correctly, not real OCR accuracy (that needs a real
// browser/WASM runtime — see this session's separate real end-to-end check,
// ROADMAP.md E3's own row).
vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(async () => ({
    recognize: vi.fn(async () => ({ data: { text: '  Lightning Bolt  \n' } })),
  })),
}));

function fakeSource(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 560;
  return canvas;
}

function stubCanvasContext() {
  const drawImageCalls: unknown[][] = [];
  const dims: { width: number; height: number }[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    dims.push({ width: this.width, height: this.height });
    return {
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
      drawImage: (...args: unknown[]) => drawImageCalls.push(args),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4).fill(128),
        width: w,
        height: h,
      }),
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
  });
  return { drawImageCalls, dims };
}

describe('extractCardText', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resizes to the canonical card size, crops+upscales the text box, and returns trimmed OCR text', async () => {
    const { dims } = stubCanvasContext();
    const text = await extractCardText(fakeSource());

    expect(text).toBe('Lightning Bolt');

    // First offscreen canvas: canonical 750x1050.
    expect(dims[0]).toEqual({ width: CANONICAL_WIDTH, height: CANONICAL_HEIGHT });
    // Second offscreen canvas: crop rect upscaled 3x.
    const crop = computeCropRect(CANONICAL_WIDTH, CANONICAL_HEIGHT);
    expect(dims[1]).toEqual({ width: crop.width * OCR_UPSCALE, height: crop.height * OCR_UPSCALE });
  });
});

describe('extractCardName', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('crops+upscales CROP_NOMBRE (the title bar), not CROP_TEXTO', async () => {
    const { dims } = stubCanvasContext();
    const text = await extractCardName(fakeSource());

    expect(text).toBe('Lightning Bolt'); // same mocked tesseract.js worker as extractCardText's test

    expect(dims[0]).toEqual({ width: CANONICAL_WIDTH, height: CANONICAL_HEIGHT });
    const crop = computeCropRect(CANONICAL_WIDTH, CANONICAL_HEIGHT, CROP_NOMBRE);
    expect(dims[1]).toEqual({ width: crop.width * OCR_UPSCALE, height: crop.height * OCR_UPSCALE });
  });
});
