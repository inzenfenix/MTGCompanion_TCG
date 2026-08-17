// @vitest-environment node
//
// Same reasoning as cardLocalizer.test.ts overriding to `node` — this test
// runs real onnxruntime-web against the real shipped model file, no DOM
// needed for that.

/**
 * ROADMAP.md I37 — regression test for a real bug found live, on-device:
 * `stage1Detector.ts::preprocess()` built an NCHW, ImageNet-mean/std-
 * normalized tensor, but the actually-shipped model
 * (`public/models/stage1-detector.onnx`, a TensorFlow/Keras export —
 * `tf2onnx`, per CLAUDE.md) expects NHWC, raw 0-255. Every real Stage 1
 * inference had been throwing `OrtRun(): Got invalid dimensions for input:
 * imagen` and silently falling open (any candidate accepted, no card
 * rejected — the actual cause behind "it captured my door"/"my controller"
 * as a card) — not a rare edge case, every single call. Confirmed directly
 * against the real graph (`onnx.load()` in Python, not guessed) before
 * fixing: input `imagen` is `[batch, 224, 224, 3]`, and the graph's very
 * first op on that input is a Keras `Rescaling` layer — so no client-side
 * normalization either.
 *
 * This test runs the REAL shipped model (not mocked) against a real input
 * tensor built by `buildInputTensor()` — the actual regression guard is
 * "does `session.run()` throw", which is exactly what broke in production
 * and wouldn't be caught by a pure-math unit test of the tensor shape alone
 * (the old code's tensor was ALSO a valid `Float32Array` of the "right"
 * total element count — the bug only shows up against the real graph).
 */
import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { buildInputTensor } from './stage1Detector';

const MODEL_PATH = path.join(__dirname, '../../../public/models/stage1-detector.onnx');

describe('stage1Detector real model (ROADMAP.md I37)', () => {
  it('buildInputTensor() output shape matches the real shipped graph — no OrtRun() shape error', { timeout: 20000 }, async () => {
    const ort = await import('onnxruntime-web');
    const session = await ort.InferenceSession.create(MODEL_PATH);

    const size = 224;
    // Synthetic but correctly-shaped RGBA input — this test's job is to
    // catch a SHAPE/LAYOUT/DTYPE mismatch (what actually broke), not to
    // assert a specific prediction on a specific photo.
    const rgba = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 120; rgba[i + 1] = 100; rgba[i + 2] = 80; rgba[i + 3] = 255;
    }

    const tensor = buildInputTensor(ort, rgba, size);
    expect(tensor.dims).toEqual([1, size, size, 3]);

    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    // This is the real regression guard: the old (NCHW) tensor shape threw
    // here in production ("Got invalid dimensions for input: imagen").
    const results = await session.run({ [inputName]: tensor });
    const output = results[outputName];
    expect(output.data.length).toBe(1);
    const p = (output.data as Float32Array)[0];
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});
