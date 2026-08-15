export type ArgKind = 'number' | 'float' | 'string' | 'boolean' | 'select' | 'file' | 'files' | 'card-percentage';

export interface ArgDef {
  flag: string | null;
  name: string;
  kind: ArgKind;
  label: string;
  default?: string | number | boolean;
  options?: string[];
  required?: boolean;
  help?: string;
  multiple?: boolean;
  /** Para kind:"select" — valor de `options` marcado como recomendado (solo cambia la etiqueta mostrada). */
  recommended?: string;
  /** Se recalcula como `factor * valor(arg)` al cambiar `arg`, hasta que el usuario lo edita a mano una vez (ver ScriptCard.tsx). */
  linkedFrom?: { arg: string; factor: number };
  /** No se renderiza en el form — se manda igual con su `default` (ver ArgForm.tsx). */
  hidden?: boolean;
}

export type ScriptGroup = 'shared' | 'pytorch' | 'tensorflow' | 'testing';

export interface ScriptInfo {
  id: string;
  group: ScriptGroup;
  label: string;
  description: string;
  env: 'pytorch' | 'tensorflow' | 'testing' | 'system';
  args: ArgDef[];
  venvReady: boolean;
}

export interface EnvInfo {
  id: string;
  label: string;
  needsVenv: boolean;
  ready: boolean;
}

/** Mismo shape que TfDockerEligibility + extras del server (tf-docker.ts / GET /tf-docker/status). */
export interface TfDockerStatus {
  eligible: boolean;
  dockerInstalled: boolean;
  reason: string | null;
  imageTag: string;
  imageReady: boolean;
}

export type TensorflowExecutionMode = 'venv' | 'docker';

/** Mismo shape que RunnerSettings del server (settings.ts). */
export interface RunnerSettings {
  tensorflowExecutionMode: TensorflowExecutionMode;
  roboflowApiKey: string | null;
}

export type RunStatus = 'idle' | 'running' | 'success' | 'error' | 'stopped';

/** Mismo shape que RunRecord del server (scripts.service.ts) — la verdad autoritativa de un run, vía GET /runs/:runId. */
export interface RunRecord {
  id: string;
  scriptId: string;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
}

export type GpuBackend = 'cuda' | 'rocm' | 'cpu';

/** Mismo shape que GpuDetectionResult del server (apps/server/src/scripts/gpu-detect.ts). */
export interface GpuInfo {
  backend: GpuBackend;
  vendor: 'nvidia' | 'amd' | 'none';
  deviceName: string | null;
  rocmChannels: string[];
  hsaOverrideGfxVersion: string | null;
  notes: string[];
}

export interface RunAllStepResult {
  scriptId: string;
  label: string;
  runId: string;
  status: 'success' | 'error' | 'stopped';
  exitCode: number | null;
  durationMs: number;
}

/** Mismo shape que arma getExportComparison() en scripts.service.ts, por etapa. */
export interface StageFrameworkMetrics {
  available: boolean;
  metrics?: Record<string, any>;
  exportScriptId: string;
}

export interface ExportComparisonStage {
  stage: string;
  label: string;
  metricKey: string;
  metricLabel: string;
  pytorch: StageFrameworkMetrics;
  tensorflow: StageFrameworkMetrics;
  recommendation: 'pytorch' | 'tensorflow' | 'tie' | null;
}

/** Mismo shape que ScraperCardCountResult del server (scryfall-card-count.ts). */
export interface ScraperCardCountResult {
  namesTotal: number;
  printsTotal: number;
  estimatedTotal: number;
  maxPrintingsPerCard: number;
  query: string;
  approximate: true;
  fetchedAt: string;
}
