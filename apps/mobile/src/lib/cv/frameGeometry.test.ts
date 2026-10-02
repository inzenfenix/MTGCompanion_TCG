import { describe, expect, it } from 'vitest';
import { computeContainLayout, computeSampleSize, mapNativeToDisplay, scalePoint } from './frameGeometry';

describe('computeSampleSize', () => {
  it('caps the longer side at maxSide, preserving aspect ratio', () => {
    expect(computeSampleSize({ width: 1920, height: 1080 }, 480)).toEqual({ width: 480, height: 270 });
    expect(computeSampleSize({ width: 1080, height: 1920 }, 480)).toEqual({ width: 270, height: 480 });
  });

  it('never upscales — leaves a frame already smaller than maxSide untouched', () => {
    expect(computeSampleSize({ width: 200, height: 100 }, 480)).toEqual({ width: 200, height: 100 });
  });
});

describe('scalePoint', () => {
  it('rescales proportionally between two pixel spaces', () => {
    expect(scalePoint({ x: 10, y: 20 }, { width: 100, height: 200 }, { width: 1000, height: 400 })).toEqual({ x: 100, y: 40 });
  });
});

describe('computeContainLayout', () => {
  it('letterboxes top/bottom when the container is wider than the video aspect', () => {
    // video 4:3 (400x300), container 16:9-ish (800x300) -> scale limited by height
    const layout = computeContainLayout({ width: 400, height: 300 }, { width: 800, height: 300 });
    expect(layout.scale).toBeCloseTo(1, 5);
    expect(layout.offsetY).toBeCloseTo(0, 5);
    expect(layout.offsetX).toBeCloseTo(200, 5); // (800 - 400*1) / 2
  });

  it('letterboxes left/right when the container is taller/narrower than the video aspect', () => {
    // video 400x300, container 200x300 -> scale limited by width
    const layout = computeContainLayout({ width: 400, height: 300 }, { width: 200, height: 300 });
    expect(layout.scale).toBeCloseTo(0.5, 5);
    expect(layout.offsetX).toBeCloseTo(0, 5);
    expect(layout.offsetY).toBeCloseTo(150 - 75, 5); // (300 - 300*0.5) / 2 = 75
  });
});

describe('mapNativeToDisplay', () => {
  it('composes scale + letterbox offset correctly', () => {
    const videoSize = { width: 400, height: 300 };
    const containerSize = { width: 200, height: 300 }; // scale 0.5, offsetX 0, offsetY 75
    expect(mapNativeToDisplay({ x: 0, y: 0 }, videoSize, containerSize)).toEqual({ x: 0, y: 75 });
    expect(mapNativeToDisplay({ x: 400, y: 300 }, videoSize, containerSize)).toEqual({ x: 200, y: 225 });
  });
});
