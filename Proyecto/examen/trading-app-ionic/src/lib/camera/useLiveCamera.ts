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

/** `label` is empty until permission has been granted at least once (privacy — MediaDeviceInfo hides it before that) — see refreshDevices(). */
export type CameraDevice = { deviceId: string; label: string };

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
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  // Ref mirror of activeDeviceId — start()/switchCamera() need the LATEST
  // value inside a stable useCallback without re-creating it (and therefore
  // GuidedCapture.tsx's effects that depend on it) every time the camera changes.
  const activeDeviceIdRef = useRef<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStatus('idle');
  }, []);

  /**
   * Real user request: `getUserMedia({video:{facingMode:'environment'}})`
   * doesn't let you pick WHICH back camera — on multi-lens phones (common
   * on real devices) that can silently resolve to the ultra-wide (0.5x)
   * lens, which looks distorted/soft up close, exactly wrong for scanning a
   * card a few cm from the lens. Device labels only become non-empty AFTER
   * a permission grant (privacy, per spec) — called again after every
   * successful start() so the list improves once permission exists, not
   * just once at mount.
   */
  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === 'videoinput').map((d) => ({ deviceId: d.deviceId, label: d.label })));
    } catch {
      // best-effort — un selector de cámara vacío no debe bloquear el flujo principal
    }
  }, []);

  const start = useCallback(
    async (deviceId?: string) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('unsupported');
        return;
      }
      setStatus('starting');
      setErrorMessage(null);
      const targetId = deviceId ?? activeDeviceIdRef.current;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // Sin deviceId elegido todavía (primer arranque): facingMode
          // sigue siendo el pedido más razonable — ya elige "alguna trasera"
          // sin necesitar permiso previo para enumerar. Una vez que el
          // usuario elige una cámara puntual, se pide esa exacta.
          video: targetId ? { deviceId: { exact: targetId } } : { facingMode: 'environment' },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const actualId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? targetId ?? null;
        activeDeviceIdRef.current = actualId;
        setActiveDeviceId(actualId);
        setStatus('streaming');
        void refreshDevices();
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setStatus(err instanceof DOMException && err.name === 'NotAllowedError' ? 'denied' : 'error');
      }
    },
    [refreshDevices],
  );

  /** Detiene el stream actual y arranca de nuevo pidiendo puntualmente `deviceId` — no hay forma de "recablear" un MediaStream existente a otro dispositivo físico, hay que pedir uno nuevo. */
  const switchCamera = useCallback(
    async (deviceId: string) => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      await start(deviceId);
    },
    [start],
  );

  /** Pasa a la siguiente cámara de la lista (ciclando) — botón simple de "cambiar cámara" sin necesitar un dropdown con labels que en muchos Android son genéricos/inútiles ("Camera 0, facing back"). El usuario confirma a ojo cuál se ve bien. No-op si hay 0-1 cámaras conocidas. */
  const cycleCamera = useCallback(() => {
    if (devices.length < 2) return;
    const currentIndex = devices.findIndex((d) => d.deviceId === activeDeviceIdRef.current);
    const next = devices[(currentIndex + 1) % devices.length];
    void switchCamera(next.deviceId);
  }, [devices, switchCamera]);

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

  return { videoRef, status, errorMessage, start, stop, captureFrame, sampleFrame, devices, activeDeviceId, switchCamera, cycleCamera };
}
