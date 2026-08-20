// ROADMAP.md I17 — safety net for any scan pipeline that mixes several
// async ML/OCR calls: a promise that hangs (neither resolves nor rejects —
// the actual failure mode hit live, tesseract.js's worker never settling
// after an init-time asset error) can't be caught by any try/catch, only
// raced against a timeout. Originally local to ListCard.tsx's
// runScanPipeline(); factored out here (ROADMAP.md J15) once Tab2.tsx's own
// scan-and-identify flow needed the exact same guard rather than a second
// copy.
export const SCAN_PIPELINE_TIMEOUT_MS = 30000;

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} tardó más de ${ms / 1000}s — timeout.`)), ms)),
  ]);
}
