/**
 * ROADMAP.md G4c — pure coordinate-mapping helpers for `GuidedCapture.tsx`.
 * No DOM/OpenCV.js dependency, so these are plain unit-testable functions.
 *
 * Two coordinate spaces are involved: the (small, downscaled) sample frame
 * `cardLocalizer.ts` actually runs on, and the on-screen displayed video
 * box the user sees. `GuidedCapture.tsx` renders the `<video>` with
 * `object-fit: contain` specifically so this mapping is a plain uniform
 * scale-and-letterbox, not a scale-and-crop — `object-fit: cover` (used
 * elsewhere in this app, e.g. Tab2's existing video feed) would need the
 * crop offset factored in too, and there's no way to compute that without
 * also duplicating the CSS `object-position` rule here.
 */

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };

/** Downscaled working size for the continuous localization loop — longer side capped at `maxSide`, aspect preserved. */
export function computeSampleSize(nativeSize: Size, maxSide: number): Size {
  const scale = Math.min(1, maxSide / Math.max(nativeSize.width, nativeSize.height));
  return {
    width: Math.max(1, Math.round(nativeSize.width * scale)),
    height: Math.max(1, Math.round(nativeSize.height * scale)),
  };
}

/** Rescales a point from one pixel space to another (e.g. sample frame -> native video frame). */
export function scalePoint(point: Point, from: Size, to: Size): Point {
  return { x: (point.x / from.width) * to.width, y: (point.y / from.height) * to.height };
}

/** Where a video box of `videoSize` lands inside a `containerSize` box under `object-fit: contain`. */
export function computeContainLayout(videoSize: Size, containerSize: Size): { scale: number; offsetX: number; offsetY: number } {
  const scale = Math.min(containerSize.width / videoSize.width, containerSize.height / videoSize.height);
  const dispW = videoSize.width * scale;
  const dispH = videoSize.height * scale;
  return { scale, offsetX: (containerSize.width - dispW) / 2, offsetY: (containerSize.height - dispH) / 2 };
}

/** Maps a point in native video pixel space to displayed-container (CSS) space, under `object-fit: contain`. */
export function mapNativeToDisplay(point: Point, videoSize: Size, containerSize: Size): Point {
  const { scale, offsetX, offsetY } = computeContainLayout(videoSize, containerSize);
  return { x: offsetX + point.x * scale, y: offsetY + point.y * scale };
}
