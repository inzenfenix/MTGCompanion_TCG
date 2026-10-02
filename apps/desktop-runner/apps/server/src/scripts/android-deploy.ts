import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { REPO_ROOT } from './tf-docker';

/**
 * Automatiza los pasos manuales que `infra/terraform/README.md`'s "After
 * apply" documentaba en texto — pegar `backend_url` en dos archivos y
 * reconstruir el APK — a pedido del usuario tras ver la tarjeta de Outputs
 * y preguntar "¿esto no se puede automatizar?" (16 ago).
 */

export const TRADING_APP_DIR = path.join(REPO_ROOT, 'apps', 'mobile');
const ENV_PATH = path.join(TRADING_APP_DIR, '.env');
const ENV_EXAMPLE_PATH = path.join(TRADING_APP_DIR, '.env.example');
const NETWORK_CONFIG_PATH = path.join(
  TRADING_APP_DIR,
  'android',
  'app',
  'src',
  'main',
  'res',
  'xml',
  'network_security_config.xml',
);

export interface ApplyBackendUrlResult {
  envPath: string;
  envUpdated: boolean;
  xmlPath: string;
  xmlUpdated: boolean;
  xmlSkippedReason: string | null;
  backendUrl: string;
  backendHost: string;
}

function upsertEnvVar(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) return content.replace(re, line);
  return `${content.trimEnd()}\n${line}\n`;
}

/**
 * `.env` (créalo desde `.env.example` si no existe todavía — mismo
 * contenido/comentarios que un `cp` manual haría) + el host de
 * `network_security_config.xml`'s cleartext exception. Idempotente: correrlo
 * de nuevo tras un `apply` distinto (host nuevo) simplemente pisa el valor
 * anterior, sea el placeholder original o un host de una corrida previa.
 */
export function applyBackendUrl(backendUrl: string, backendHost: string): ApplyBackendUrlResult {
  const baseEnv = fs.existsSync(ENV_PATH)
    ? fs.readFileSync(ENV_PATH, 'utf-8')
    : fs.existsSync(ENV_EXAMPLE_PATH)
      ? fs.readFileSync(ENV_EXAMPLE_PATH, 'utf-8')
      : `VITE_API_BASE_URL=${backendUrl}\n`;
  const nextEnv = upsertEnvVar(baseEnv, 'VITE_API_BASE_URL', backendUrl);
  const envUpdated = !fs.existsSync(ENV_PATH) || nextEnv !== baseEnv;
  fs.writeFileSync(ENV_PATH, nextEnv);

  let xmlUpdated = false;
  let xmlSkippedReason: string | null = null;
  if (!fs.existsSync(NETWORK_CONFIG_PATH)) {
    xmlSkippedReason = `No existe ${NETWORK_CONFIG_PATH} — corré "npx cap add android" primero (ver ROADMAP.md E3d).`;
  } else {
    const xml = fs.readFileSync(NETWORK_CONFIG_PATH, 'utf-8');
    const nextXml = xml.replace(/(<domain includeSubdomains="false">)[^<]*(<\/domain>)/, `$1${backendHost}$2`);
    if (nextXml === xml) {
      xmlSkippedReason = xml.includes(backendHost) ? null : 'No se encontró el tag <domain> esperado — revisar el archivo a mano.';
    } else {
      fs.writeFileSync(NETWORK_CONFIG_PATH, nextXml);
      xmlUpdated = true;
    }
  }

  return { envPath: ENV_PATH, envUpdated, xmlPath: NETWORK_CONFIG_PATH, xmlUpdated, xmlSkippedReason, backendUrl, backendHost };
}

/**
 * `gradlew` necesita un JDK real (`JAVA_HOME`) — si el entorno ya lo trae
 * (CI, o alguien que lo configuró a mano) se respeta tal cual; si no, se
 * busca el JDK portable que ROADMAP.md's E3d instaló para esta máquina
 * (`~/Android/jdk/jdk-*`, sin sudo, ver esa entrada para el porqué). Si
 * tampoco existe, se devuelve undefined y gradlew usa lo que haya en el
 * PATH del sistema — no es un error automático, simplemente puede fallar
 * con un mensaje claro de gradle si de verdad no hay JDK en ningún lado.
 */
export function resolveAndroidJavaHome(): string | undefined {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME;
  const base = path.join(os.homedir(), 'Android', 'jdk');
  try {
    const entries = fs.readdirSync(base).filter((e) => e.startsWith('jdk-'));
    if (entries.length) return path.join(base, entries[0]);
  } catch {
    // no existe ~/Android/jdk en esta máquina — no es un error, solo no hay nada que ofrecer
  }
  return undefined;
}
