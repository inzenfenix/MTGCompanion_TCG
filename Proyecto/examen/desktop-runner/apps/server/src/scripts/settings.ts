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
  /**
   * API key personal de Roboflow (https://roboflow.com), usada solo por
   * `shared-download-roboflow` para bajar los datasets reales de Stage 4
   * (certamen_2/download_roboflow_condition_data.py). Se guarda acá (no en
   * el repo, no hardcodeada en ningún script) para que cada quien use su
   * propia key — null si todavía no se configuró.
   */
  roboflowApiKey: string | null;
}

const DEFAULTS: RunnerSettings = { tensorflowExecutionMode: 'venv', roboflowApiKey: null };

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
