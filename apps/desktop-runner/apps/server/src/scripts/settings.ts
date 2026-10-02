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
   * (ml/data-prep/download_roboflow_condition_data.py). Se guarda acá (no en
   * el repo, no hardcodeada en ningún script) para que cada quien use su
   * propia key — null si todavía no se configuró.
   */
  roboflowApiKey: string | null;
  /**
   * Credenciales AWS temporales (ROADMAP.md workstream I) para correr
   * Terraform localmente contra la cuenta real (AWS Academy Learner Lab
   * suele rotar estas cada ~4h). Nunca se escriben al repo ni a
   * terraform.tfvars — solo viven acá y se inyectan como env vars
   * TF_VAR_* al proceso de terraform que se lanza (ver terraform.ts).
   */
  awsCredentials: AwsCredentials | null;
  /**
   * Checklist informativo de qué servicios AWS están en juego — EC2/S3/
   * Secrets Manager tienen efecto real (S3 vs. MinIO condiciona
   * `use_minio` en terraform.tfvars); SNS/SQS/DynamoDB/Cognito son
   * puramente documentales (esta app no los integra hoy — ver
   * infra/PLAN.md "Open decision").
   */
  awsServicesChecklist: AwsServicesChecklist;
}

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** null para un usuario IAM normal de larga duración; obligatorio para Academy Lab. */
  sessionToken: string | null;
  /** Date.now() al guardar — la UI lo usa para el aviso de "puede estar vencida" (Academy Lab expira ~4h). */
  savedAt: number;
}

export interface AwsServicesChecklist {
  ec2: boolean;
  s3: boolean;
  secretsManager: boolean;
  sns: boolean;
  sqs: boolean;
  dynamodb: boolean;
  cognito: boolean;
  /** El único checkbox con efecto real en infra — espeja terraform.tfvars' use_minio, no lo aplica solo. */
  useMinio: boolean;
}

const DEFAULT_AWS_SERVICES_CHECKLIST: AwsServicesChecklist = {
  ec2: true,
  s3: true,
  secretsManager: true,
  sns: false,
  sqs: false,
  dynamodb: false,
  cognito: false,
  useMinio: false,
};

const DEFAULTS: RunnerSettings = {
  tensorflowExecutionMode: 'venv',
  roboflowApiKey: null,
  awsCredentials: null,
  awsServicesChecklist: DEFAULT_AWS_SERVICES_CHECKLIST,
};

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
