/**
 * ROADMAP.md G4c — live guided-capture UX: a face-detection-demo-style
 * bounding box tracks the card in real time over the live camera feed,
 * with a small progress readout through the capture process itself
 * (searching -> found -> holding steady -> captured), plus an explicit
 * "couldn't find it" state on timeout rather than a silent full-frame
 * fallback.
 *
 * Two-speed loop (roadmap tip #1): a cheap `requestAnimationFrame` pass,
 * throttled to ~150ms, runs `cardLocalizer.ts::localizarCarta()` on a small
 * downscaled sample frame (`useLiveCamera.ts::sampleFrame()`) purely to
 * drive the live overlay/feedback — the expensive part (a full-res
 * re-localize + perspective warp) only happens once, gated on stability
 * (N consecutive good frames) or a manual tap, matching
 * `captureFrame()`'s existing one-shot contract.
 *
 * Renders ONLY the overlay (canvas + status text + capture button) — the
 * caller (`Tab2.tsx`) still owns the `<video>` element itself (status
 * messages for starting/denied/unsupported, etc. are already handled
 * there). This component just needs `camera` (a `useLiveCamera()`
 * instance) and draws on top of whatever box the caller lays the video out
 * in. **Caller must render the video with `object-fit: contain`**, not
 * `cover` — the overlay math (`frameGeometry.ts::mapNativeToDisplay`)
 * assumes no crop.
 *
 * No Web Worker (roadmap tip #6 flags this as a "consider if jank shows
 * up" — not built preemptively; OpenCV.js's contour-search cost at this
 * resolution measured at ~11-24ms/frame in Node, real headroom under the
 * 150ms budget, see ROADMAP.md G4c's own row for the numbers).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { IonButton, IonIcon } from '@ionic/react';
import { scanOutline, refreshOutline, cameraReverseOutline } from 'ionicons/icons';
import { useTranslation } from 'react-i18next';
import type { useLiveCamera } from '../lib/camera/useLiveCamera';
import {
  CANONICAL_HEIGHT, CANONICAL_WIDTH, corregirPerspectiva, detectarBrilloEspecular, detectarDesenfoque, getOpenCv, localizarCarta,
  matFromRgba, type Corners, type OpenCvModule,
} from '../lib/cv/cardLocalizer';
import { computeSampleSize, mapNativeToDisplay, scalePoint, type Size } from '../lib/cv/frameGeometry';

const SAMPLE_MAX_SIDE = 480; // ROADMAP.md G4c: ~11-24ms/frame at this size (measured), comfortable under the loop budget below
const LOOP_INTERVAL_MS = 150;
const STABILITY_FRAMES_REQUIRED = 6; // ~900ms of continuous good detection before auto-capture
const SEARCH_TIMEOUT_MS = 7000;
// How long the "that's not a card" message stays on screen before the loop
// resumes searching. Without this the next ~150ms tick would just overwrite
// it with 'searching'/'aligning' the instant a face (or whatever geometric
// false-positive) re-triangulates, and the user would never actually see it.
const REJECTED_COOLDOWN_MS = 2000;

type LoopState = 'initializing' | 'searching' | 'aligning' | 'capturing' | 'timeout' | 'rejected' | 'glare' | 'blur' | 'captured' | 'vision-error';
const VISION_LOAD_TIMEOUT_MS = 20000; // OpenCV.js is ~15MB of WASM — genuinely slow to compile on some real devices, but this needs a ceiling: getOpenCv().then(...) below had no .catch() at all, so any real failure (not just slowness) hung 'initializing' forever with zero feedback (found live — a real user got stuck on "Loading vision..." with no way out short of leaving the screen).
// 'no-candidate': localizarCarta/perspective-warp found nothing at full res
// (same honest "couldn't find it" case as before). 'rejected': a candidate
// WAS found and warped, but Stage 1 (the real trained MTG/no-MTG
// classifier, run by the caller) confidently says it isn't a card — see
// ROADMAP.md G4c's face-false-positive writeup. The geometric/color-only
// localizer alone can't tell a face from a card; this is the real content
// check gating the capture, not just the heuristic. 'glare': a candidate WAS
// found and warped, but `detectarBrilloEspecular` flagged a large specular
// highlight (sleeve-glare follow-up) — checked BEFORE Stage 1 so a glary
// capture never wastes an inference call on data we already know is
// compromised, and gets its own actionable message instead of a generic
// "not a card" one. 'blur': a candidate WAS found and warped, but
// `detectarDesenfoque` (variance of Laplacian) says it's too blurry — motion
// or bad focus, which degrades everything downstream even worse than glare
// does (OCR especially, ROADMAP.md I19/I22/I23) — checked FIRST, before
// glare/Stage 1, same "don't waste work on data we already know is bad"
// reasoning.
type CaptureOutcome = 'captured' | 'no-candidate' | 'rejected' | 'glare' | 'blur';

export type GuidedCaptureProps = {
  camera: ReturnType<typeof useLiveCamera>;
  /**
   * Called once with the perspective-corrected, canonical-sized (750x1050)
   * canvas, for Stage 1 inference. Resolve `true` to accept the capture
   * (transitions to 'captured'), or `false` to reject it as a confident
   * non-card (transitions to 'rejected' and the loop resumes searching) —
   * see ROADMAP.md G4c.
   */
  onCaptured: (canvas: HTMLCanvasElement) => Promise<boolean>;
};

export function GuidedCapture({ camera, onCaptured }: GuidedCaptureProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const cvRef = useRef<OpenCvModule | null>(null);

  const [loopState, setLoopState] = useState<LoopState>('initializing');
  const [progress, setProgress] = useState(0); // 0..1, stability counter / STABILITY_FRAMES_REQUIRED
  // Real state (not just cvRef, a ref) specifically so the loop effect below
  // re-runs once OpenCV.js finishes loading — it very often finishes AFTER
  // camera.status already settled to 'streaming' (getUserMedia starts much
  // faster than a ~15MB WASM module loads), and an effect keyed only on
  // camera.status would never get a second chance to start the loop once
  // cv becomes ready. (Real bug, found live: the manual capture button
  // worked because by the time a user taps it cv has usually finished
  // loading in the background, but the live loop never started at all.)
  const [cvReady, setCvReady] = useState(false);

  // Loop-internal mutable state — refs, not React state, so the ~150ms tick
  // doesn't force a re-render every frame (only loopState/progress changes do).
  const stabilityRef = useRef(0);
  const searchStartRef = useRef<number>(Date.now());
  const armedRef = useRef(true); // false right after a capture, until the user taps "Escanear de nuevo"
  const rejectedUntilRef = useRef(0); // timestamp; loop pauses re-searching until this passes, so 'rejected' is actually readable
  const rafRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const lastTickRef = useRef(0);

  const drawOverlay = useCallback((corners: Corners | null, videoSize: Size) => {
    const canvas = overlayRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    if (!corners) return;
    const displayCorners = corners.map((p) => mapNativeToDisplay(p, videoSize, { width: w, height: h }));
    const stable = stabilityRef.current >= STABILITY_FRAMES_REQUIRED;
    ctx.strokeStyle = stable ? '#4ade80' : '#f2e3cd'; // green once stable, else the app's parchment accent
    ctx.lineWidth = 3;
    ctx.beginPath();
    displayCorners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    displayCorners.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = stable ? '#4ade80' : '#f2e3cd';
      ctx.fill();
    });
  }, []);

  const doCapture = useCallback(async (): Promise<CaptureOutcome> => {
    const cv = cvRef.current;
    if (!cv) return 'no-candidate';
    const fullFrame = camera.captureFrame();
    if (!fullFrame) return 'no-candidate';
    const ctx = fullFrame.getContext('2d');
    if (!ctx) return 'no-candidate';
    const imageData = ctx.getImageData(0, 0, fullFrame.width, fullFrame.height);
    const mat = matFromRgba(cv, imageData.data, imageData.width, imageData.height);
    try {
      const result = localizarCarta(cv, mat);
      if (!result) return 'no-candidate';
      const warped = corregirPerspectiva(cv, mat, result.corners, CANONICAL_WIDTH, CANONICAL_HEIGHT);
      try {
        // Checked first, before glare/Stage 1: a blurry capture is already
        // known-bad data (OCR especially — ROADMAP.md I19/I22/I23), so
        // there's no point spending any further work on it.
        const blur = detectarDesenfoque(cv, warped);
        if (blur.isBlurry) return 'blur';

        // Checked before Stage 1: a glary capture is already known-bad data
        // (OCR/embedding/condition-grading all degrade under a specular
        // highlight), so there's no point spending a Stage 1 inference call
        // on it — and "glare detected" is a more actionable message than
        // whatever Stage 1 would say about a partially-washed-out card.
        const glare = detectarBrilloEspecular(cv, warped);
        if (glare.hasGlare) return 'glare';

        const outCanvas = document.createElement('canvas');
        outCanvas.width = CANONICAL_WIDTH;
        outCanvas.height = CANONICAL_HEIGHT;
        const outCtx = outCanvas.getContext('2d');
        if (!outCtx) return 'no-candidate';
        const outData = outCtx.createImageData(CANONICAL_WIDTH, CANONICAL_HEIGHT);
        outData.data.set(warped.data);
        outCtx.putImageData(outData, 0, 0);
        // The geometric localizer alone can't tell a card from a
        // similarly-shaped/toned non-card (a face, most often — see
        // ROADMAP.md G4c). Stage 1's real classifier is the actual content
        // check; only accept the capture if the caller confirms it.
        const accepted = await onCaptured(outCanvas);
        return accepted ? 'captured' : 'rejected';
      } finally {
        warped.delete();
      }
    } finally {
      mat.delete();
    }
  }, [camera, onCaptured]);

  const manualCapture = useCallback(async () => {
    setLoopState('capturing');
    const outcome = await doCapture();
    if (!mountedRef.current) return;
    if (outcome === 'captured') {
      armedRef.current = false;
      setLoopState('captured');
    } else if (outcome === 'rejected' || outcome === 'glare' || outcome === 'blur') {
      setLoopState(outcome);
      rejectedUntilRef.current = Date.now() + REJECTED_COOLDOWN_MS;
      searchStartRef.current = Date.now();
    } else {
      // Real photo, no candidate at full res even though the user tapped
      // deliberately — same honest "couldn't find it" state as a timeout,
      // not a silent no-op.
      setLoopState('timeout');
      searchStartRef.current = Date.now();
    }
  }, [doCapture]);

  const rearm = useCallback(() => {
    armedRef.current = true;
    stabilityRef.current = 0;
    rejectedUntilRef.current = 0;
    searchStartRef.current = Date.now();
    setProgress(0);
    setLoopState('searching');
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (!cancelled) setLoopState('vision-error');
    }, VISION_LOAD_TIMEOUT_MS);

    getOpenCv()
      .then((cv) => {
        if (cancelled || timedOut) return; // ya se mostró el error por timeout — no lo pises si igual termina resolviendo tarde
        clearTimeout(timer);
        cvRef.current = cv;
        searchStartRef.current = Date.now();
        setLoopState('searching');
        setCvReady(true);
      })
      .catch((err) => {
        // Real bug, found live: sin este catch, cualquier falla acá (no
        // solo lentitud) dejaba "Loading vision..." pegado para siempre,
        // sin ningún error visible ni forma de salir del estado.
        console.error('[GuidedCapture] getOpenCv() failed:', err);
        clearTimeout(timer);
        if (!cancelled) setLoopState('vision-error');
      });

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (camera.status !== 'streaming' || !cvReady || !cvRef.current) return;

    const tick = async (now: number) => {
      rafRef.current = requestAnimationFrame(tick);
      if (now - lastTickRef.current < LOOP_INTERVAL_MS) return;
      lastTickRef.current = now;
      if (!armedRef.current) return; // paused after a successful capture, until rearm()
      if (now < rejectedUntilRef.current) return; // paused so the 'rejected' message is actually readable

      const cv = cvRef.current;
      const video = camera.videoRef.current;
      if (!cv || !video || !video.videoWidth) return;

      const videoSize: Size = { width: video.videoWidth, height: video.videoHeight };
      const sampleSize = computeSampleSize(videoSize, SAMPLE_MAX_SIDE);
      const imageData = camera.sampleFrame(sampleSize.width, sampleSize.height);
      if (!imageData) return;

      const mat = matFromRgba(cv, imageData.data, imageData.width, imageData.height);
      let result;
      try {
        result = localizarCarta(cv, mat);
      } finally {
        mat.delete();
      }

      if (result) {
        stabilityRef.current += 1;
        searchStartRef.current = now; // found something -> reset the "been searching too long" clock
        const nativeCorners = result.corners.map((p) => scalePoint(p, sampleSize, videoSize)) as Corners;
        drawOverlay(nativeCorners, videoSize);
        setProgress(Math.min(1, stabilityRef.current / STABILITY_FRAMES_REQUIRED));
        setLoopState(stabilityRef.current >= STABILITY_FRAMES_REQUIRED ? 'capturing' : 'aligning');

        if (stabilityRef.current >= STABILITY_FRAMES_REQUIRED) {
          stabilityRef.current = 0;
          const outcome = await doCapture();
          if (!mountedRef.current) return;
          if (outcome === 'captured') {
            armedRef.current = false;
            setLoopState('captured');
          } else if (outcome === 'rejected' || outcome === 'glare' || outcome === 'blur') {
            setLoopState(outcome);
            rejectedUntilRef.current = now + REJECTED_COOLDOWN_MS;
            searchStartRef.current = now;
          } else {
            setLoopState('searching');
          }
        }
      } else {
        stabilityRef.current = 0;
        setProgress(0);
        drawOverlay(null, videoSize);
        if (now - searchStartRef.current > SEARCH_TIMEOUT_MS) {
          setLoopState('timeout');
        } else {
          setLoopState('searching');
        }
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- camera/doCapture/drawOverlay are stable-enough refs/callbacks; re-running this effect per-render would restart the loop for no reason
  }, [camera.status, cvReady]);

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0 }}>
      <canvas ref={overlayRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', width: '100%', height: '100%' }} />

      <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
        <p style={{ color: '#f2e3cd', fontSize: '0.9rem', margin: '0 0 8px', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
          {loopState === 'initializing' && t('guided_capture_initializing')}
          {loopState === 'searching' && t('guided_capture_searching')}
          {loopState === 'aligning' && t('guided_capture_aligning', { percent: Math.round(progress * 100) })}
          {loopState === 'capturing' && t('guided_capture_capturing')}
          {loopState === 'timeout' && t('guided_capture_timeout')}
          {loopState === 'rejected' && t('guided_capture_rejected')}
          {loopState === 'glare' && t('guided_capture_glare')}
          {loopState === 'blur' && t('guided_capture_blur')}
          {loopState === 'captured' && t('guided_capture_captured')}
          {loopState === 'vision-error' && t('guided_capture_vision_error')}
        </p>
      </div>

      {loopState !== 'captured' && (
        <IonButton
          size="small"
          fill="outline"
          className="mtg-btn"
          disabled={loopState === 'initializing' || loopState === 'capturing' || loopState === 'vision-error'}
          onClick={manualCapture}
          style={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'auto' }}
        >
          <div className="mtg-btn-content">
            <IonIcon icon={scanOutline} />
            <span>{t('guided_capture_manual_button')}</span>
          </div>
        </IonButton>
      )}

      {loopState === 'captured' && (
        <IonButton
          size="small"
          fill="outline"
          className="mtg-btn"
          onClick={rearm}
          style={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'auto' }}
        >
          <div className="mtg-btn-content">
            <IonIcon icon={refreshOutline} />
            <span>{t('guided_capture_rescan_button')}</span>
          </div>
        </IonButton>
      )}

      {/* Real user request: getUserMedia({facingMode:'environment'}) doesn't
          let you pick WHICH back lens — on multi-camera phones that can
          silently resolve to the ultra-wide (0.5x), which looks
          distorted/soft this close to the card. Only shown once we actually
          know there's more than one to switch between (devices list is
          empty until the first successful start() — see useLiveCamera.ts). */}
      {camera.devices.length > 1 && loopState !== 'captured' && (
        <IonButton
          size="small"
          fill="outline"
          className="mtg-btn"
          disabled={loopState === 'initializing'}
          onClick={camera.cycleCamera}
          style={{ position: 'absolute', top: 8, right: 8, pointerEvents: 'auto' }}
          aria-label={t('guided_capture_switch_camera_button')}
        >
          <IonIcon icon={cameraReverseOutline} />
        </IonButton>
      )}
    </div>
  );
}
