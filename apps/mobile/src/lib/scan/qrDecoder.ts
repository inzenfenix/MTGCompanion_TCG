import jsQR from 'jsqr';

/**
 * Real camera-based QR decoding (ROADMAP.md J4) — replaces Tab2.tsx's
 * manual "paste the code" text field, the explicit stand-in E5 shipped
 * because no decoder library existed in the project yet.
 *
 * Deliberately a pure function over a canvas, not a component — the same
 * "cardLocalizer.ts is pure, GuidedCapture.tsx drives it" split this
 * project already uses for OpenCV.js (G4c), so this is unit-testable
 * without a live camera.
 */
export function decodeQrFromCanvas(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const result = jsQR(imageData.data, imageData.width, imageData.height);
  return result?.data ?? null;
}
