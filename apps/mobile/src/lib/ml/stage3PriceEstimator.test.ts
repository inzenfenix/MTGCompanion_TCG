/**
 * ROADMAP.md G3 — unit tests for stage3PriceEstimator.ts's status-branch
 * logic and feature-tensor assembly, without real `.onnx`/scaler files.
 * `onnxruntime-web` and `fetch` (both the HEAD probes and the scaler JSON
 * GET) are mocked.
 *
 * Uses the manual mock at `<root>/__mocks__/onnxruntime-web.ts` (via
 * `vi.mock('onnxruntime-web')`, no inline factory) rather than an
 * inline `vi.mock`/`vi.doMock` factory — stage3 does TWO concurrent
 * dynamic `import('onnxruntime-web')` calls
 * (`Promise.all([getEmbedderSession(), getPriceSession(), ...])`), and an
 * inline factory (registered per-file or re-registered per-test) raced
 * with that concurrency in this Vitest version: only one of the two
 * concurrent imports reliably picked up the mock, the other fell through
 * to the real package and tried to open a real .onnx file (reproduced and
 * confirmed in isolation before landing on this fix — a root-level manual
 * mock file is resolved once through Vite's module graph instead of
 * per-call-site, which sidesteps the race entirely).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScryfallCardFields, TabularScaler } from './priceFeatures';
import { mockState as ortMockState } from '../../../__mocks__/onnxruntime-web';

vi.mock('onnxruntime-web');

const SCALER: TabularScaler = {
  fields: ['cmc', 'n_colores', 'n_frame_effects', 'anio', 'antiguedad_anios', 'edhrec_rank_log'],
  mean: [2.0, 1.5, 0.2, 2015.0, 10.0, 3.0],
  std: [1.0, 1.0, 0.5, 5.0, 5.0, 2.0],
};

const CARD: ScryfallCardFields = {
  cmc: 1, colors: [], color_identity: [], type_line: 'Artifact',
  rarity: 'uncommon', set_type: 'core', frame: '1993', border_color: 'black',
};

type RunFn = (feeds: Record<string, { data: Float32Array; dims: number[] }>) => Promise<Record<string, { data: Float32Array }>>;

let lastPriceFeeds: Record<string, { data: Float32Array; dims: number[] }> | null = null;
let testCounter = 0;

/**
 * Fresh module instance per test (distinct module state for the
 * memoized session/scaler promises) via a cache-busting query string —
 * deliberately NOT `vi.resetModules()`, which also tears down the
 * `__mocks__/onnxruntime-web.ts` module instance itself and disconnects
 * it from the `ortMockState` reference captured at this file's top,
 * silently making every subsequent `installOrtCreateImpl()` call a no-op.
 */
function importFreshStage3() {
  testCounter += 1;
  return import(/* @vite-ignore */ `./stage3PriceEstimator?test=${testCounter}`);
}

function installOrtCreateImpl(opts: { embedderRun?: RunFn; priceRun?: RunFn } = {}) {
  const embedderRun = opts.embedderRun ?? (async () => ({ output: { data: new Float32Array(1280).fill(0.01) } }));
  const priceRun = opts.priceRun ?? (async () => ({ price_log1p: { data: new Float32Array([Math.log1p(5)]) } }));

  ortMockState.createImpl = async (url: string) => {
    if (url.includes('embedder')) {
      return { inputNames: ['imagen'], outputNames: ['output'], run: embedderRun };
    }
    return {
      inputNames: ['features'],
      outputNames: ['price_log1p'],
      run: (feeds: Record<string, { data: Float32Array; dims: number[] }>) => {
        lastPriceFeeds = feeds;
        return priceRun(feeds);
      },
    };
  };
}

function fakeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 224;
  canvas.height = 224;
  return canvas;
}

/** Real jsdom canvas has no 2D image backend — stub getContext to return a minimal fake ctx. */
function stubCanvasContext() {
  const fakeImageData = { data: new Uint8ClampedArray(224 * 224 * 4) };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn().mockReturnValue(fakeImageData),
  } as unknown as CanvasRenderingContext2D);
}

function mockFetch(opts: { headEmbedder?: boolean; headPrice?: boolean; scaler?: TabularScaler | 'missing' | 'network-error' }) {
  const { headEmbedder = true, headPrice = true, scaler = SCALER } = opts;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        if (url.includes('embedder')) return Promise.resolve({ ok: headEmbedder } as Response);
        if (url.includes('price-estimator')) return Promise.resolve({ ok: headPrice } as Response);
        return Promise.resolve({ ok: false } as Response);
      }
      // Scaler GET.
      if (scaler === 'network-error') return Promise.reject(new Error('offline'));
      if (scaler === 'missing') return Promise.resolve({ ok: false } as Response);
      return Promise.resolve({ ok: true, json: () => Promise.resolve(scaler) } as Response);
    }),
  );
}

describe('runStage3PriceEstimation', () => {
  beforeEach(() => {
    stubCanvasContext();
    installOrtCreateImpl();
    lastPriceFeeds = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns "unavailable" when the embedder model is missing', async () => {
    mockFetch({ headEmbedder: false });
    const { runStage3PriceEstimation } = (await importFreshStage3()) as typeof import('./stage3PriceEstimator');

    const result = await runStage3PriceEstimation(fakeCanvas(), CARD);

    expect(result.status).toBe('unavailable');
  });

  it('returns "unavailable" when the price model is missing', async () => {
    mockFetch({ headPrice: false });
    const { runStage3PriceEstimation } = (await importFreshStage3()) as typeof import('./stage3PriceEstimator');

    const result = await runStage3PriceEstimation(fakeCanvas(), CARD);

    expect(result.status).toBe('unavailable');
  });

  it('returns "error" (not "unavailable") when both models exist but the scaler is missing — a real, known gap (see ROADMAP.md E2)', async () => {
    mockFetch({ scaler: 'missing' });
    const { runStage3PriceEstimation } = (await importFreshStage3()) as typeof import('./stage3PriceEstimator');

    const result = await runStage3PriceEstimation(fakeCanvas(), CARD);

    expect(result.status).toBe('error');
  });

  it('returns "error" when the scaler fetch throws (offline)', async () => {
    mockFetch({ scaler: 'network-error' });
    const { runStage3PriceEstimation } = (await importFreshStage3()) as typeof import('./stage3PriceEstimator');

    const result = await runStage3PriceEstimation(fakeCanvas(), CARD);

    expect(result.status).toBe('error');
  });

  it('applies Math.expm1 to the raw price_log1p output to get priceUsd', async () => {
    mockFetch({});
    installOrtCreateImpl({ priceRun: async () => ({ price_log1p: { data: new Float32Array([Math.log1p(42.5)]) } }) });
    const { runStage3PriceEstimation } = (await importFreshStage3()) as typeof import('./stage3PriceEstimator');

    const result = await runStage3PriceEstimation(fakeCanvas(), CARD);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.result.priceUsd).toBeCloseTo(42.5, 5);
  });

  it('feeds the price model a 1330-dim vector: concat[tabular(50), visual(1280)]', async () => {
    mockFetch({});
    const { runStage3PriceEstimation } = (await importFreshStage3()) as typeof import('./stage3PriceEstimator');

    await runStage3PriceEstimation(fakeCanvas(), CARD);

    expect(lastPriceFeeds?.features.dims).toEqual([1, 1330]);
  });

  it('the first 50 dims of the price-model input are the scaled tabular vector, the rest the visual embedding', async () => {
    mockFetch({});
    installOrtCreateImpl({ embedderRun: async () => ({ output: { data: new Float32Array(1280).fill(0.5) } }) });
    const { runStage3PriceEstimation } = (await importFreshStage3()) as typeof import('./stage3PriceEstimator');

    await runStage3PriceEstimation(fakeCanvas(), CARD);

    const data = lastPriceFeeds!.features.data;
    expect(data.length).toBe(1330);
    expect(Array.from(data.slice(50, 1330)).every((v) => v === 0.5)).toBe(true);
  });

  it('rejects an embedder output with the wrong dimensionality instead of silently continuing', async () => {
    mockFetch({});
    installOrtCreateImpl({ embedderRun: async () => ({ output: { data: new Float32Array(999) } }) }); // wrong dim
    const { runStage3PriceEstimation } = (await importFreshStage3()) as typeof import('./stage3PriceEstimator');

    const result = await runStage3PriceEstimation(fakeCanvas(), CARD);

    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.message).toMatch(/forma inesperada|999/);
  });
});
