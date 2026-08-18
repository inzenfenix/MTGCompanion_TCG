import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeQrFromCanvas } from './qrDecoder';

// jsdom has no real 2D canvas backend (same tradeoff stage3PriceEstimator.test.ts/
// ocrExtractor.test.ts already document) — getContext is stubbed to return
// synthetic ImageData instead of a real one. A round-trip "actually decodes
// a real QR bitmap" test would need a QR *encoder* producing real pixel
// data (react-qr-code renders SVG, not raster) — not worth building just
// for this thin wrapper; these two cases cover what the function itself is
// responsible for (no context -> null, real jsQR call on non-QR data ->
// null, no crash), the same honesty this project's other CV modules use.
function stubCanvasContext(hasContext: boolean) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    if (!hasContext) return null;
    return {
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4).fill(200),
        width: w,
        height: h,
        colorSpace: 'srgb' as PredefinedColorSpace,
      }),
    } as unknown as CanvasRenderingContext2D;
  });
}

describe('decodeQrFromCanvas', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when the canvas has no 2D context', () => {
    stubCanvasContext(false);
    const canvas = document.createElement('canvas');
    expect(decodeQrFromCanvas(canvas)).toBeNull();
  });

  it('returns null (not a crash) when the frame contains no decodable QR code', () => {
    stubCanvasContext(true);
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    expect(decodeQrFromCanvas(canvas)).toBeNull();
  });
});
