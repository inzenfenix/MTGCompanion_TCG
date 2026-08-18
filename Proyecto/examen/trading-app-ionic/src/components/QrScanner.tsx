/**
 * ROADMAP.md J4 — real camera-based QR scanning, replacing Tab2.tsx's
 * manual "paste the code" text field (react-qr-code, the library already
 * in the project, only generates codes — it never decoded them).
 *
 * Same split as GuidedCapture.tsx (G4c): renders ONLY a status overlay —
 * the caller owns the `<video>` element itself. Deliberately much simpler
 * than GuidedCapture: no OpenCV.js, no localization/stability logic — a QR
 * code is either decodable in a given frame or it isn't, there's no
 * "aligning" state to track. Polls `camera.captureFrame()` (full
 * resolution — jsQR needs real detail, unlike the downscaled sample frame
 * G4c's cheap loop uses) on a plain interval and hands each frame to
 * `qrDecoder.ts::decodeQrFromCanvas()`, a pure function unit-tested on its
 * own.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { useLiveCamera } from '../lib/camera/useLiveCamera';
import { decodeQrFromCanvas } from '../lib/scan/qrDecoder';

const SCAN_INTERVAL_MS = 300;

interface QrScannerProps {
  camera: ReturnType<typeof useLiveCamera>;
  onDecoded: (text: string) => void;
  /** Pauses the scan loop without unmounting — e.g. while the parent is handling a just-decoded result. */
  paused?: boolean;
}

export const QrScanner: React.FC<QrScannerProps> = ({ camera, onDecoded, paused }) => {
  const { t } = useTranslation();
  const onDecodedRef = useRef(onDecoded);
  onDecodedRef.current = onDecoded;
  const [notFoundYet, setNotFoundYet] = useState(true);

  useEffect(() => {
    if (camera.status !== 'streaming' || paused) return;
    setNotFoundYet(true);
    const interval = setInterval(() => {
      const canvas = camera.captureFrame();
      if (!canvas) return;
      const text = decodeQrFromCanvas(canvas);
      if (text) {
        setNotFoundYet(false);
        onDecodedRef.current(text);
      }
    }, SCAN_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- camera.captureFrame is a stable ref from useLiveCamera
  }, [camera.status, paused]);

  if (camera.status !== 'streaming') return null;

  return (
    <div
      style={{
        position: 'absolute', bottom: 12, left: 0, right: 0,
        textAlign: 'center', color: '#f2e3cd', fontSize: '0.85rem',
        textShadow: '0 1px 3px rgba(0,0,0,0.8)', pointerEvents: 'none',
      }}
    >
      {notFoundYet ? t('qr_scan_searching') : t('qr_scan_found')}
    </div>
  );
};
