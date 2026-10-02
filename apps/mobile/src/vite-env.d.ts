/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the backend API (backend/). Defaults to http://localhost:3000 — see src/lib/api.ts. */
  readonly VITE_API_BASE_URL?: string;
  /** Where the Stage 1 (MTG / no-MTG) ONNX model is served from. Defaults to /models/stage1-detector.onnx — see src/lib/ml/stage1Detector.ts. */
  readonly VITE_STAGE1_MODEL_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
