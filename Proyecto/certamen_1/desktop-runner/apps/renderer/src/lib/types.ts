export type ArgKind = 'number' | 'float' | 'string' | 'boolean' | 'select' | 'file' | 'files';

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

export type RunStatus = 'idle' | 'running' | 'success' | 'error' | 'stopped';

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
