import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Preferencias del usuario que sobreviven entre corridas de la app — hoy
 * solo una: cómo correr los scripts de TensorFlow. Vive en el home del
 * usuario, no en el repo (no es algo para versionar ni algo atado a un
 * checkout puntual) y no en localStorage del renderer (el server también la
 * necesita para decidir cómo lanzar cada script, no solo la UI).
 */
export interface RunnerSettings {
  /**
   * 'venv' (default): el venv de tensorFlow/ vía pip, CPU en AMD (no hay
   * wheel ROCm mantenido — ver CLAUDE.md regla 6). 'docker': imagen
   * `rocm/tensorflow` con GPU passthrough (ver tf-docker.ts) — solo tiene
   * sentido si getTfDockerEligibility() da eligible:true; si no, runScript()
   * cae de vuelta a 'venv' igual, este valor es solo la preferencia.
   */
  tensorflowExecutionMode: 'venv' | 'docker';
}

const DEFAULTS: RunnerSettings = { tensorflowExecutionMode: 'venv' };

const SETTINGS_DIR = path.join(os.homedir(), '.mtg-desktop-runner');
const SETTINGS_PATH = path.join(SETTINGS_DIR, 'settings.json');

export function readSettings(): RunnerSettings {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS }; // no existe todavía, o está corrupto — se usa el default
  }
}

export function writeSettings(patch: Partial<RunnerSettings>): RunnerSettings {
  const next = { ...readSettings(), ...patch };
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
  return next;
}
