import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Live camera capture via `navigator.mediaDevices.getUserMedia` + a hidden
 * <canvas> — NOT @capacitor-community/camera-preview. Per the documented
 * architecture decision (Proyecto/examen/README.md), live-scan (this hook,
 * used by Tab2's "Scan & Appraise") uses getUserMedia+canvas so frames can
 * be grabbed continuously for inference; @capacitor/camera is reserved for
 * one-shot single-photo capture (used by ListCard.tsx when listing a card).
 * camera-preview is an explicitly deferred upgrade path (native camera
 * layer instead of a <video> element) — not needed for this pass.
 */

export type CameraStatus = 'idle' | 'starting' | 'streaming' | 'denied' | 'unsupported' | 'error';

export function useLiveCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Reused across calls, unlike captureFrame()'s new-canvas-per-call — this
  // is meant for GuidedCapture.tsx's ~150ms continuous localization loop
  // (ROADMAP.md G4c), where allocating a fresh canvas every tick would be
  // wasteful GC churn for no benefit (the loop only ever needs one small
  // scratch buffer, reused in place).
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStatus('idle');
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      return;
    }
    setStatus('starting');
    setErrorMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus('streaming');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus(err instanceof DOMException && err.name === 'NotAllowedError' ? 'denied' : 'error');
    }
  }, []);

  // Always release the camera device when the component unmounts.
  useEffect(() => stop, [stop]);

  /** Grabs the current video frame onto an offscreen canvas for inference. */
  const captureFrame = useCallback((): HTMLCanvasElement | null => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }, []);

  /**
   * Draws the current video frame, downscaled to `width`x`height`, into a
   * persistent reused canvas — the cheap side of G4c's "two-speed loop"
   * (roadmap tip #1: a throttled continuous localization pass, distinct
   * from the expensive one-shot Stage 1 ONNX call `captureFrame()` feeds).
   * Returns `ImageData` directly rather than the canvas itself, since every
   * caller (`cardLocalizer.ts::matFromRgba`) just wants the raw pixels.
   */
  const sampleFrame = useCallback((width: number, height: number): ImageData | null => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    if (!sampleCanvasRef.current) sampleCanvasRef.current = document.createElement('canvas');
    const canvas = sampleCanvasRef.current;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  }, []);

  return { videoRef, status, errorMessage, start, stop, captureFrame, sampleFrame };
}
