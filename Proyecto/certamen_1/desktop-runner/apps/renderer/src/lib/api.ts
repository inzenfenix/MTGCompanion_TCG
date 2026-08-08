import { io, Socket } from 'socket.io-client';
import type { EnvInfo, RunAllStepResult, ScriptInfo } from './types';

export const API_BASE = (import.meta as any).env?.VITE_API_BASE || 'http://127.0.0.1:4550';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  scripts: () => fetch(`${API_BASE}/scripts`).then((r) => json<ScriptInfo[]>(r)),
  envs: () => fetch(`${API_BASE}/envs`).then((r) => json<EnvInfo[]>(r)),
  ensureVenv: (envId: string) =>
    fetch(`${API_BASE}/envs/${envId}/ensure`, { method: 'POST' }).then((r) => json<{ ok: boolean }>(r)),
  run: (scriptId: string, values: Record<string, unknown>) =>
    fetch(`${API_BASE}/scripts/${scriptId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    }).then((r) => json<{ runId: string }>(r)),
  stop: (runId: string) => fetch(`${API_BASE}/runs/${runId}/stop`, { method: 'POST' }).then((r) => json<{ ok: boolean }>(r)),
  runAll: (framework: 'pytorch' | 'tensorflow') =>
    fetch(`${API_BASE}/run-all/${framework}`, { method: 'POST' }).then((r) => json<{ started: boolean }>(r)),
  runEverything: () =>
    fetch(`${API_BASE}/run-everything`, { method: 'POST' }).then((r) => json<{ started: boolean }>(r)),
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
  framework: 'pytorch' | 'tensorflow' | 'everything';
  scriptId: string;
  label: string;
  runId: string;
}

export interface RunAllReportEvent {
  overallRunId: string;
  framework: 'pytorch' | 'tensorflow' | 'everything';
  steps: RunAllStepResult[];
  ok: boolean;
}
