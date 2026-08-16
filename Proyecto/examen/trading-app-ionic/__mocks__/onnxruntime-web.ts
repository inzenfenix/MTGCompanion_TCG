// Vitest manual mock for the `onnxruntime-web` npm package (ROADMAP.md G3).
// Placed at the project root per Vitest's node_modules-mocking convention
// so it's resolved once through Vite's module graph rather than
// per-call-site — `stage3PriceEstimator.ts` does TWO concurrent dynamic
// `import('onnxruntime-web')` calls (`Promise.all([getEmbedderSession(),
// getPriceSession(), ...])`), and re-registering an inline `vi.mock`
// factory per test raced with that concurrency (only one of the two
// imports reliably picked up the mock, the other fell through to the real
// package and tried to open a real .onnx file — a Vitest/Vite quirk with
// concurrent first-time dynamic imports of a freshly (re-)mocked bare
// specifier, reproduced in isolation before landing on this fix).
import { vi } from 'vitest';

export const mockState = {
  createImpl: null as ((url: string) => Promise<unknown>) | null,
};

export const InferenceSession = {
  create: vi.fn((url: string) => mockState.createImpl!(url)),
};

export class Tensor {
  type: string;
  data: Float32Array;
  dims: number[];
  constructor(type: string, data: Float32Array, dims: number[]) {
    this.type = type;
    this.data = data;
    this.dims = dims;
  }
}
