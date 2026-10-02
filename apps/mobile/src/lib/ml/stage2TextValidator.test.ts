/**
 * ROADMAP.md G3 — unit tests for stage2TextValidator.ts's status-branch
 * logic (unavailable/error/ok) and feature-tensor construction, without a
 * real `.onnx` file — `onnxruntime-web` and `fetch` are mocked. Live
 * end-to-end parity against the real exported model was already verified
 * by hand in ROADMAP.md's E1 (0.00e+00 diff on 6 real pairs); this suite
 * covers the wrapper logic around that call, which E1 didn't have
 * automated coverage for.
 *
 * `vi.resetModules()` + a fresh dynamic `import()` per test is needed
 * because stage2TextValidator.ts memoizes its ONNX session in a
 * module-level `let sessionPromise` (by design, so a real app only loads
 * the model once) — without resetting, the first test's mocked session
 * would leak into every later test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HEAD_OK = { ok: true } as Response;
const HEAD_404 = { ok: false } as Response;

function mockOrt(runImpl: (feeds: Record<string, { data: Float32Array; dims: number[] }>) => Promise<Record<string, { data: Float32Array }>>) {
  vi.doMock('onnxruntime-web', () => ({
    InferenceSession: {
      create: vi.fn().mockResolvedValue({
        inputNames: ['features'],
        outputNames: ['logit'],
        run: vi.fn(runImpl),
      }),
    },
    Tensor: class {
      type: string;
      data: Float32Array;
      dims: number[];
      constructor(type: string, data: Float32Array, dims: number[]) {
        this.type = type;
        this.data = data;
        this.dims = dims;
      }
    },
  }));
}

describe('runStage2Validation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('onnxruntime-web');
  });

  it('returns "unavailable" when the model file HEAD request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(HEAD_404));
    const { runStage2Validation } = await import('./stage2TextValidator');

    const result = await runStage2Validation('Lightning Bolt', 'Lightning Bolt');

    expect(result.status).toBe('unavailable');
  });

  it('returns "unavailable" when fetch itself rejects (e.g. offline)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const { runStage2Validation } = await import('./stage2TextValidator');

    const result = await runStage2Validation('Lightning Bolt', 'Lightning Bolt');

    expect(result.status).toBe('unavailable');
  });

  it('applies sigmoid to the raw logit and thresholds at 0.5 for isMatch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(HEAD_OK));
    mockOrt(async () => ({ logit: { data: new Float32Array([2.0]) } })); // sigmoid(2.0) ≈ 0.881
    const { runStage2Validation } = await import('./stage2TextValidator');

    const result = await runStage2Validation('Lightning Bolt', 'Lightning Bolt');

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.result.confidence).toBeCloseTo(1 / (1 + Math.exp(-2.0)), 6);
      expect(result.result.isMatch).toBe(true);
    }
  });

  it('a negative logit (confidence < 0.5) yields isMatch: false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(HEAD_OK));
    mockOrt(async () => ({ logit: { data: new Float32Array([-3.0]) } }));
    const { runStage2Validation } = await import('./stage2TextValidator');

    const result = await runStage2Validation('garbled ocr text', 'Lightning Bolt deals 3 damage');

    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.result.isMatch).toBe(false);
  });

  it('builds a 2048-dim feature tensor: concat[v_ocr(512), v_ref(512), |diff|(512), product(512)]', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(HEAD_OK));
    let capturedDims: number[] | null = null;
    mockOrt(async (feeds) => {
      capturedDims = feeds.features.dims ?? null;
      return { logit: { data: new Float32Array([0]) } };
    });
    const { runStage2Validation } = await import('./stage2TextValidator');

    await runStage2Validation('Sol Ring', 'Sol Ring');

    expect(capturedDims).toEqual([1, 2048]);
  });

  it('identical ocr/ref text yields an all-zero "diff" quarter of the feature vector', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(HEAD_OK));
    let captured: Float32Array | null = null;
    mockOrt(async (feeds) => {
      captured = feeds.features.data;
      return { logit: { data: new Float32Array([0]) } };
    });
    const { runStage2Validation } = await import('./stage2TextValidator');

    await runStage2Validation('Sol Ring', 'Sol Ring');

    const dim = 512;
    const diffQuarter = captured!.slice(2 * dim, 3 * dim);
    expect(Array.from(diffQuarter).every((v) => v === 0)).toBe(true);
  });

  it('returns "error" (not a crash) when the ONNX session throws during run()', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(HEAD_OK));
    mockOrt(async () => {
      throw new Error('boom');
    });
    const { runStage2Validation } = await import('./stage2TextValidator');

    const result = await runStage2Validation('a', 'b');

    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.message).toContain('boom');
  });
});
