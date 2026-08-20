import { io, Socket } from 'socket.io-client';
import type {
  EnvInfo,
  ExportComparisonStage,
  GpuInfo,
  RunAllStepResult,
  RunnerSettings,
  RunRecord,
  ScraperCardCountResult,
  ScriptInfo,
  ApplyBackendUrlResult,
  SsmInstanceDef,
  SsmInstanceKey,
  SsmStatus,
  TerraformAction,
  TerraformStatus,
  TfDockerStatus,
  ToolInstallTarget,
} from './types';

export const API_BASE = (import.meta as any).env?.VITE_API_BASE || 'http://127.0.0.1:4550';

// El status HTTP se cuelga en el Error (no solo el mensaje) porque algunos
// callers necesitan distinguir "el server respondió que esto no existe"
// (404 — un hecho terminal) de una falla de red transitoria (server caído
// un instante, p.ej. a mitad de un restart de dev-watch) — ver useRunLogs.
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    // Nest devuelve {"statusCode":...,"message":"...","error":"..."} — sin
    // esto, el error que llega al componente es el JSON crudo tal cual
    // ("{"statusCode":500,...}"), que es lo que se veía en la UI en vez del
    // motivo real de la falla.
    let message = text || `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed?.message === 'string') message = parsed.message;
      else if (Array.isArray(parsed?.message)) message = parsed.message.join(', ');
    } catch {
      // no era JSON — se deja el texto crudo (o el statusText) como está
    }
    throw new ApiError(message, res.status);
  }
  return res.json();
}

export const api = {
  scripts: () => fetch(`${API_BASE}/scripts`).then((r) => json<ScriptInfo[]>(r)),
  envs: () => fetch(`${API_BASE}/envs`).then((r) => json<EnvInfo[]>(r)),
  gpu: () => fetch(`${API_BASE}/gpu`).then((r) => json<GpuInfo>(r)),
  tfDockerStatus: () => fetch(`${API_BASE}/tf-docker/status`).then((r) => json<TfDockerStatus>(r)),
  getSettings: () => fetch(`${API_BASE}/settings`).then((r) => json<RunnerSettings>(r)),
  updateSettings: (patch: Partial<RunnerSettings>) =>
    fetch(`${API_BASE}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((r) => json<RunnerSettings>(r)),
  ensureVenv: (envId: string) =>
    fetch(`${API_BASE}/envs/${envId}/ensure`, { method: 'POST' }).then((r) => json<{ ok: boolean }>(r)),
  run: (scriptId: string, values: Record<string, unknown>) =>
    fetch(`${API_BASE}/scripts/${scriptId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    }).then((r) => json<{ runId: string }>(r)),
  stop: (runId: string) => fetch(`${API_BASE}/runs/${runId}/stop`, { method: 'POST' }).then((r) => json<{ ok: boolean }>(r)),
  getRun: (runId: string) => fetch(`${API_BASE}/runs/${runId}`).then((r) => json<RunRecord>(r)),
  runAll: (framework: 'pytorch' | 'tensorflow' | 'export') =>
    fetch(`${API_BASE}/run-all/${framework}`, { method: 'POST' }).then((r) => json<{ started: boolean }>(r)),
  runEverything: () =>
    fetch(`${API_BASE}/run-everything`, { method: 'POST' }).then((r) => json<{ started: boolean }>(r)),
  runAllSequences: () =>
    fetch(`${API_BASE}/run-all-sequences`).then((r) => json<Record<'pytorch' | 'tensorflow', string[]>>(r)),
  runSequence: (label: string, scriptIds: string[]) =>
    fetch(`${API_BASE}/run-sequence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, scriptIds }),
    }).then((r) => json<{ started: boolean }>(r)),
  exportComparison: () => fetch(`${API_BASE}/export/comparison`).then((r) => json<ExportComparisonStage[]>(r)),
  uploadModelsToS3: () => fetch(`${API_BASE}/export/upload-s3`, { method: 'POST' }).then((r) => json<{ runId: string }>(r)),
  scraperCardCount: () =>
    fetch(`${API_BASE}/scripts/shared-scraper/card-count`).then((r) => json<ScraperCardCountResult>(r)),
  terraformStatus: () => fetch(`${API_BASE}/terraform/status`).then((r) => json<TerraformStatus>(r)),
  runTerraform: (action: TerraformAction, confirm = false) =>
    fetch(`${API_BASE}/terraform/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm }),
    }).then((r) => json<{ runId: string }>(r)),
  terraformOutputs: () => fetch(`${API_BASE}/terraform/outputs`).then((r) => json<Record<string, unknown> | null>(r)),
  deployBackend: () => fetch(`${API_BASE}/deploy/backend`, { method: 'POST' }).then((r) => json<{ runId: string }>(r)),
  installTool: (tool: ToolInstallTarget) =>
    fetch(`${API_BASE}/terraform/install/${tool}`, { method: 'POST' }).then((r) => json<{ runId: string }>(r)),
  ssmInstances: () => fetch(`${API_BASE}/ssm/instances`).then((r) => json<SsmInstanceDef[]>(r)),
  ssmStatus: () => fetch(`${API_BASE}/ssm/status`).then((r) => json<SsmStatus>(r)),
  ssmOpenTerminal: (instance: SsmInstanceKey) =>
    fetch(`${API_BASE}/ssm/terminal/${instance}`, { method: 'POST' }).then((r) => json<{ ok: boolean }>(r)),
  ssmStartPortForward: (instance: SsmInstanceKey) =>
    fetch(`${API_BASE}/ssm/port-forward/${instance}`, { method: 'POST' }).then((r) => json<{ runId: string }>(r)),
  applyAndroidBackendUrl: () =>
    fetch(`${API_BASE}/android/apply-backend-url`, { method: 'POST' }).then((r) => json<ApplyBackendUrlResult>(r)),
  rebuildApk: () => fetch(`${API_BASE}/android/rebuild-apk`, { method: 'POST' }).then((r) => json<{ runId: string }>(r)),
  importCatalog: () => fetch(`${API_BASE}/ssm/import-catalog`, { method: 'POST' }).then((r) => json<{ runId: string }>(r)),
  seedDatabase: () => fetch(`${API_BASE}/ssm/seed-database`, { method: 'POST' }).then((r) => json<{ runId: string }>(r)),
};

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(API_BASE, { transports: ['websocket'] });
  }
  return socket;
}

export interface LogEvent {
  runId: string;
  stream: 'stdout' | 'stderr';
  data: string;
}

export interface StatusEvent {
  runId: string;
  status: 'running' | 'success' | 'error' | 'stopped';
  exitCode?: number | null;
}

export interface VenvProgressEvent {
  envId: string;
  message: string;
}

export interface ResultEvent {
  runId: string;
  results: { kind: 'scanner' | 'metrics' | 'optuna' | 'classifier-metrics'; label: string; data: any }[];
}

export interface LiveStatsEvent {
  runId: string;
  kind: 'training-history';
  data: any;
}

export interface RunAllStepStartedEvent {
  overallRunId: string;
  framework: string;
  scriptId: string;
  label: string;
  runId: string;
}

export interface RunAllReportEvent {
  overallRunId: string;
  framework: string;
  steps: RunAllStepResult[];
  ok: boolean;
}
