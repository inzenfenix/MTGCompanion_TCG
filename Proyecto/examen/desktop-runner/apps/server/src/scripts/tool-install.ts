import { spawn } from 'child_process';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import AdmZip from 'adm-zip';

/**
 * Instalador automático de `terraform`/`aws` para la pestaña "Deploy"
 * (ROADMAP.md workstream I) — hoy esa tarjeta solo decía "no instalado" y
 * dejaba el resto a mano. Cubre las 3 máquinas de este proyecto: Windows,
 * Ubuntu y Fedora/Nobara (sin macOS, decisión explícita del usuario).
 *
 * Principio: nunca `sudo`. En Linux (Ubuntu y Fedora comparten el mismo
 * camino — no hace falta distinguir apt/dnf) ambos binarios se bajan
 * oficiales y se instalan 100% en el home del usuario
 * (`~/.mtg-desktop-runner/`), nunca en `/usr/local` ni vía gestor de
 * paquetes del sistema. En Windows se usa `winget` primero (mismo patrón ya
 * probado en este proyecto para instalar tesseract sin admin — ver
 * CLAUDE.md/H2); si winget no está, cae a un fallback que sí puede pedir
 * permiso de administrador vía el diálogo de Windows (UAC) — terraform.exe
 * vía zip (sin admin, TOOL_BIN_DIR) y AWS CLI vía su instalador .msi oficial
 * en modo silencioso (`msiexec /qn`, sin wizard, pero igual puede disparar
 * el prompt de UAC porque escribe en Program Files) — nunca `sudo`, pero
 * pedir esa elevación está explícitamente permitido por el usuario.
 */

export const TOOL_BIN_DIR = path.join(os.homedir(), '.mtg-desktop-runner', 'bin');

export type ToolInstallTarget = 'terraform' | 'aws-cli' | 'session-manager-plugin' | 'gh';

export type InstallLogger = (message: string) => void;

/**
 * PATH con TOOL_BIN_DIR antepuesto, para que un terraform/aws bajado acá se
 * use sin tocar el PATH real del sistema. No-op si el directorio no existe
 * o está vacío — el delimiter simplemente no encuentra nada ahí y el PATH
 * de siempre sigue funcionando igual. Se usa tanto al *probar* si el
 * comando existe (terraform.ts::getTerraformEligibility) como al *correr*
 * terraform/aws de verdad (scripts.service.ts).
 */
export function pathEnvWithToolBin(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const current = base.PATH ?? base.Path ?? '';
  const augmented = `${TOOL_BIN_DIR}${path.delimiter}${current}`;
  // Windows resuelve el nombre de la variable sin distinguir mayúsculas, pero
  // Node arma el entorno del hijo por comparación exacta de string — sin
  // ambas claves, cuál "gana" depende de qué haya en process.env de por sí.
  return { ...base, PATH: augmented, ...(process.platform === 'win32' ? { Path: augmented } : {}) };
}

function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, ['--version']);
    } catch {
      resolve(false);
      return;
    }
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

function runAndStream(cmd: string, args: string[], cwd: string, log: InstallLogger): Promise<void> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd });
    } catch (err) {
      reject(err);
      return;
    }
    child.stdout?.on('data', (d) => log(d.toString().trimEnd()));
    child.stderr?.on('data', (d) => log(d.toString().trimEnd()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`"${cmd} ${args.join(' ')}" terminó con código ${code}`))));
  });
}

/**
 * No confiar solo en el exit code del paso anterior — se comprueba viendo
 * si el binario recién instalado corre de verdad. Hace falta de verdad:
 * el instalador embebido de AWS CLI terminó con exit 0 en una prueba real
 * incluso con `dist/aws` sin el bit +x (el error real quedó enterrado en un
 * `Permission denied` de una línea intermedia del script, no en su código
 * de salida) — sin este chequeo, ese fallo se hubiera reportado como éxito.
 */
function verifyBinaryOrThrow(binPath: string, versionArgs: string[], log: InstallLogger): Promise<void> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(binPath, versionArgs);
    } catch (err) {
      reject(new Error(`No se pudo verificar la instalación (${binPath}): ${err instanceof Error ? err.message : String(err)}`));
      return;
    }
    let out = '';
    child.stdout?.on('data', (d) => (out += d.toString()));
    child.on('error', (err) => reject(new Error(`No se pudo verificar la instalación (${binPath}): ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) {
        log(`Verificado: ${out.trim().split('\n')[0]}`);
        resolve();
      } else {
        reject(new Error(`"${binPath} ${versionArgs.join(' ')}" terminó con código ${code} — la instalación quedó incompleta.`));
      }
    });
  });
}

/** `headers` opcional — la API de GitHub (api.github.com) rechaza con 403 cualquier request sin User-Agent, a diferencia de checkpoint-api.hashicorp.com (terraform) que no lo exige. */
function fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`GET ${url} → HTTP ${res.statusCode}`));
          return;
        }
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

/** Sigue redirects a mano — `https.get` de Node no lo hace solo, y tanto releases.hashicorp.com como awscli.amazonaws.com pueden 30x hacia su CDN. */
function download(url: string, destPath: string, log: InstallLogger, redirectsLeft = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    log(`Descargando ${url} ...`);
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          download(res.headers.location, destPath, log, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Descarga falló: HTTP ${res.statusCode} en ${url}`));
          return;
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

function archNames(): { terraformArch: 'amd64' | 'arm64'; awsArch: 'x86_64' | 'aarch64' } {
  const isArm = process.arch === 'arm64';
  return { terraformArch: isArm ? 'arm64' : 'amd64', awsArch: isArm ? 'aarch64' : 'x86_64' };
}

/**
 * Terraform vía zip oficial de HashiCorp — versión resuelta en vivo (API de
 * checkpoint, la misma que usa terraform para chequear updates), sin
 * versión hardcodeada para no quedar desactualizado. Un solo binario
 * (`terraform`/`terraform.exe`) directo a TOOL_BIN_DIR, sin instalador,
 * sin admin, funciona igual en Linux (Ubuntu/Fedora) y como fallback en
 * Windows si no hay winget.
 */
export async function installTerraformViaZip(log: InstallLogger): Promise<void> {
  const platform = process.platform === 'win32' ? 'windows' : 'linux';
  const { terraformArch } = archNames();

  log('Resolviendo la última versión de Terraform (checkpoint-api.hashicorp.com) ...');
  const { current_version: version } = await fetchJson<{ current_version: string }>(
    'https://checkpoint-api.hashicorp.com/v1/check/terraform',
  );
  log(`Última versión: ${version}`);

  const zipUrl = `https://releases.hashicorp.com/terraform/${version}/terraform_${version}_${platform}_${terraformArch}.zip`;
  fs.mkdirSync(TOOL_BIN_DIR, { recursive: true });
  const zipPath = path.join(os.tmpdir(), `terraform_${version}_${Date.now()}.zip`);
  try {
    await download(zipUrl, zipPath, log);
    log(`Descomprimiendo en ${TOOL_BIN_DIR} ...`);
    // keepOriginalPermission:true — sin esto AdmZip extrae todo sin el bit
    // +x del zip (confirmado con una instalación real: terraform quedaba
    // "Permission denied" al ejecutarlo), y el chmod de más abajo solo
    // cubre el binario en sí, no cualquier otro ejecutable del archivo.
    new AdmZip(zipPath).extractAllTo(TOOL_BIN_DIR, true, true);
  } finally {
    fs.rmSync(zipPath, { force: true });
  }

  const binName = platform === 'windows' ? 'terraform.exe' : 'terraform';
  const binPath = path.join(TOOL_BIN_DIR, binName);
  if (platform !== 'windows') fs.chmodSync(binPath, 0o755);
  await verifyBinaryOrThrow(binPath, ['version'], log);
  log(`Terraform ${version} instalado en ${TOOL_BIN_DIR}.`);
}

/**
 * AWS CLI v2 en Linux (Ubuntu y Fedora, mismo camino) — zip oficial con URL
 * "siempre la última" (documentada por AWS, no hace falta resolver
 * versión), instalado con su propio instalador embebido en modo
 * enteramente de usuario: `-i`/`-b` apuntan dentro de
 * ~/.mtg-desktop-runner/, nunca a /usr/local/aws-cli — por diseño oficial
 * de ese instalador (no es un hack), nunca pide sudo.
 */
export async function installAwsCliLinux(log: InstallLogger): Promise<void> {
  const { awsArch } = archNames();
  const zipUrl = `https://awscli.amazonaws.com/awscli-exe-linux-${awsArch}.zip`;

  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aws-cli-install-'));
  try {
    const zipPath = path.join(stageDir, 'awscliv2.zip');
    await download(zipUrl, zipPath, log);

    log('Descomprimiendo el instalador de AWS CLI ...');
    // keepOriginalPermission:true — el instalador embebido de AWS CLI
    // necesita que su propio binario (`aws/dist/aws`) ya venga +x del zip,
    // si no el paso final del `install` script termina en `Permission
    // denied` en una línea intermedia pero sigue e igual sale con exit 0
    // (confirmado con una instalación real) — verifyBinaryOrThrow() de abajo
    // es lo que realmente detecta ese caso, no el código de salida del script.
    new AdmZip(zipPath).extractAllTo(stageDir, true, true);

    const installRoot = path.join(os.homedir(), '.mtg-desktop-runner', 'aws-cli');
    fs.mkdirSync(TOOL_BIN_DIR, { recursive: true });
    const installScript = path.join(stageDir, 'aws', 'install');
    log(`Instalando en ${installRoot} (sin sudo, --update por si ya había una instalación previa) ...`);
    await runAndStream('bash', [installScript, '-i', installRoot, '-b', TOOL_BIN_DIR, '--update'], stageDir, log);
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
  await verifyBinaryOrThrow(path.join(TOOL_BIN_DIR, 'aws'), ['--version'], log);
  log(`AWS CLI instalado en ${TOOL_BIN_DIR}.`);
}

/** Mismo patrón ya usado en este proyecto (CLAUDE.md/H2, tesseract vía winget) — instala en el scope del usuario cuando el paquete lo soporta, sin admin en la mayoría de los casos. */
async function installViaWinget(packageId: string, log: InstallLogger): Promise<void> {
  log(`Instalando ${packageId} vía winget ...`);
  await runAndStream(
    'winget',
    ['install', '--id', packageId, '-e', '--accept-package-agreements', '--accept-source-agreements', '--silent'],
    os.homedir(),
    log,
  );
}

/** Fallback de AWS CLI en Windows sin winget: el .msi oficial, en modo silencioso (sin wizard) pero que igual puede disparar el prompt de permiso de administrador de Windows (UAC) al escribir en Program Files — permitido explícitamente por el usuario, nunca sudo. */
async function installAwsCliWindowsMsi(log: InstallLogger): Promise<void> {
  const msiPath = path.join(os.tmpdir(), `AWSCLIV2_${Date.now()}.msi`);
  try {
    await download('https://awscli.amazonaws.com/AWSCLIV2.msi', msiPath, log);
    log('Instalando AWS CLI (instalador oficial .msi, silencioso) — puede aparecer el diálogo de permiso de administrador de Windows ...');
    await runAndStream('msiexec', ['/i', msiPath, '/qn', '/norestart'], os.tmpdir(), log);
  } finally {
    fs.rmSync(msiPath, { force: true });
  }
  log('AWS CLI instalado. Puede hacer falta reabrir esta app para que tome el PATH actualizado.');
}

/**
 * Nombre interno idéntico dentro del .deb y del .rpm oficiales de AWS
 * (confirmado bajando y extrayendo ambos en esta máquina):
 * `usr/local/sessionmanagerplugin/bin/session-manager-plugin` — no hace
 * falta instalarlo ahí, solo copiar ese binario a TOOL_BIN_DIR (ya está en
 * el PATH que usan los `aws` que lanza este proyecto).
 */
const SMP_BINARY_REL_PATH = path.join('usr', 'local', 'sessionmanagerplugin', 'bin', 'session-manager-plugin');

/** Ubuntu/Debian -> 'deb'; Fedora/RHEL/Nobara -> 'rpm'. Se lee /etc/os-release en vez de asumir por `process.platform` (que solo dice "linux", no la distro) — ID_LIKE cubre derivados (Nobara declara `ID_LIKE="rhel centos fedora"`, no `ID=fedora`). */
function linuxPackageFamily(): 'deb' | 'rpm' {
  let osRelease = '';
  try {
    osRelease = fs.readFileSync('/etc/os-release', 'utf-8');
  } catch {
    return 'deb'; // no se pudo leer — deb es la familia más común, mejor default que fallar
  }
  const idLine = /^ID=(.*)$/m.exec(osRelease)?.[1]?.replace(/"/g, '') ?? '';
  const idLikeLine = /^ID_LIKE=(.*)$/m.exec(osRelease)?.[1]?.replace(/"/g, '') ?? '';
  const haystack = `${idLine} ${idLikeLine}`.toLowerCase();
  if (/debian|ubuntu/.test(haystack)) return 'deb';
  if (/fedora|rhel|centos/.test(haystack)) return 'rpm';
  return 'deb';
}

/**
 * Session Manager Plugin en Linux (Ubuntu y Fedora/Nobara) — hace falta
 * para el `aws ssm start-session` interactivo que usa el botón "Abrir
 * terminal" del Deploy tab (NO para `deploy-backend.sh`, que usa
 * `ssm send-command`/Run Command y no necesita este plugin en absoluto).
 * Se extrae el paquete oficial (.deb con `dpkg-deb -x`, .rpm con
 * `rpm2cpio | cpio`) SIN instalarlo — ninguno de los dos comandos de
 * extracción pide root, a diferencia de `dpkg -i`/`rpm -i`, que sí lo
 * piden. Confirmado en esta máquina: mismo path interno en ambos formatos.
 */
async function installSessionManagerPluginLinux(log: InstallLogger): Promise<void> {
  const family = linuxPackageFamily();
  const url =
    family === 'deb'
      ? 'https://s3.amazonaws.com/session-manager-downloads/plugin/latest/ubuntu_64bit/session-manager-plugin.deb'
      : 'https://s3.amazonaws.com/session-manager-downloads/plugin/latest/linux_64bit/session-manager-plugin.rpm';
  log(`Detectada familia de paquetes: ${family} (via /etc/os-release).`);

  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-manager-plugin-install-'));
  try {
    const pkgPath = path.join(stageDir, family === 'deb' ? 'smp.deb' : 'smp.rpm');
    await download(url, pkgPath, log);

    const extractedDir = path.join(stageDir, 'extracted');
    fs.mkdirSync(extractedDir, { recursive: true });
    log('Extrayendo el paquete (sin instalarlo — sin root) ...');
    if (family === 'deb') {
      await runAndStream('dpkg-deb', ['-x', pkgPath, extractedDir], stageDir, log);
    } else {
      // rpm2cpio no acepta un directorio de salida — se pipea a `cpio -idm`
      // corriendo YA adentro de extractedDir (cwd del hijo).
      await new Promise<void>((resolve, reject) => {
        const rpm2cpio = spawn('rpm2cpio', [pkgPath]);
        const cpio = spawn('cpio', ['-idm'], { cwd: extractedDir });
        rpm2cpio.stdout.pipe(cpio.stdin);
        rpm2cpio.stderr.on('data', (d) => log(d.toString().trimEnd()));
        cpio.stderr.on('data', (d) => log(d.toString().trimEnd()));
        let settled = false;
        const fail = (err: Error) => {
          if (settled) return;
          settled = true;
          reject(err);
        };
        rpm2cpio.on('error', fail);
        cpio.on('error', fail);
        cpio.on('close', (code) => {
          if (settled) return;
          settled = true;
          code === 0 ? resolve() : reject(new Error(`cpio -idm terminó con código ${code}`));
        });
      });
    }

    fs.mkdirSync(TOOL_BIN_DIR, { recursive: true });
    const extractedBinary = path.join(extractedDir, SMP_BINARY_REL_PATH);
    const destBinary = path.join(TOOL_BIN_DIR, 'session-manager-plugin');
    fs.copyFileSync(extractedBinary, destBinary);
    fs.chmodSync(destBinary, 0o755);
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
  await verifyBinaryOrThrow(path.join(TOOL_BIN_DIR, 'session-manager-plugin'), ['--version'], log);
  log(`Session Manager Plugin instalado en ${TOOL_BIN_DIR}.`);
}

/** Windows: no hay paquete winget oficial para esto (a diferencia de terraform/aws cli) — siempre el instalador .exe oficial, en modo silencioso. Puede pedir UAC (escribe en Program Files), permitido explícitamente por el usuario. */
async function installSessionManagerPluginWindows(log: InstallLogger): Promise<void> {
  const exePath = path.join(os.tmpdir(), `SessionManagerPluginSetup_${Date.now()}.exe`);
  try {
    await download('https://s3.amazonaws.com/session-manager-downloads/plugin/latest/windows/SessionManagerPluginSetup.exe', exePath, log);
    log('Instalando Session Manager Plugin (instalador oficial, silencioso) — puede aparecer el diálogo de permiso de administrador de Windows ...');
    await runAndStream(exePath, ['/quiet', '/install'], os.tmpdir(), log);
  } finally {
    fs.rmSync(exePath, { force: true });
  }
  log('Session Manager Plugin instalado. Puede hacer falta reabrir esta app para que tome el PATH actualizado.');
}

export async function installTerraform(log: InstallLogger): Promise<void> {
  if (process.platform === 'win32' && (await commandExists('winget'))) {
    await installViaWinget('Hashicorp.Terraform', log);
    return;
  }
  await installTerraformViaZip(log);
}

export async function installAwsCli(log: InstallLogger): Promise<void> {
  if (process.platform === 'win32') {
    if (await commandExists('winget')) {
      await installViaWinget('Amazon.AWSCLI', log);
      return;
    }
    await installAwsCliWindowsMsi(log);
    return;
  }
  await installAwsCliLinux(log);
}

export async function installSessionManagerPlugin(log: InstallLogger): Promise<void> {
  if (process.platform === 'win32') {
    await installSessionManagerPluginWindows(log);
    return;
  }
  await installSessionManagerPluginLinux(log);
}

/**
 * GitHub CLI (`gh`) — ROADMAP.md M3, hace falta para disparar/seguir el
 * workflow de M2 desde el botón del Deploy tab. Igual que terraform/aws
 * cli: versión resuelta en vivo (API de GitHub, no hardcodeada), sin sudo,
 * directo a TOOL_BIN_DIR.
 *
 * Linux: el release oficial es un `.tar.gz` (no un `.zip` como
 * terraform/aws) — se extrae con el `tar` del sistema (`spawn`, no
 * AdmZip, que solo entiende zip) en vez de sumar una dependencia npm nueva
 * solo para esto; tanto Ubuntu/Fedora como Windows 10+ (bsdtar bundleado)
 * lo tienen, pero acá solo se usa en la rama Linux — Windows prioriza
 * winget y cae a un `.msi` oficial (mismo patrón que AWS CLI).
 */
async function installGithubCliLinux(log: InstallLogger): Promise<void> {
  const { terraformArch: arch } = archNames(); // gh usa la misma convención amd64/arm64 que terraform, no x86_64/aarch64 como aws cli

  log('Resolviendo la última versión de GitHub CLI (api.github.com/repos/cli/cli/releases/latest) ...');
  const { tag_name: tagName } = await fetchJson<{ tag_name: string }>(
    'https://api.github.com/repos/cli/cli/releases/latest',
    { 'User-Agent': 'mtg-desktop-runner' },
  );
  const version = tagName.replace(/^v/, '');
  log(`Última versión: ${version}`);

  const assetBase = `gh_${version}_linux_${arch}`;
  const tarUrl = `https://github.com/cli/cli/releases/download/${tagName}/${assetBase}.tar.gz`;

  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-cli-install-'));
  try {
    const tarPath = path.join(stageDir, 'gh.tar.gz');
    await download(tarUrl, tarPath, log);

    log(`Descomprimiendo en ${stageDir} ...`);
    await runAndStream('tar', ['-xzf', tarPath, '-C', stageDir], stageDir, log);

    fs.mkdirSync(TOOL_BIN_DIR, { recursive: true });
    const extractedBinary = path.join(stageDir, assetBase, 'bin', 'gh');
    const destBinary = path.join(TOOL_BIN_DIR, 'gh');
    fs.copyFileSync(extractedBinary, destBinary);
    fs.chmodSync(destBinary, 0o755);
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
  await verifyBinaryOrThrow(path.join(TOOL_BIN_DIR, 'gh'), ['--version'], log);
  log(`GitHub CLI ${version} instalado en ${TOOL_BIN_DIR}.`);
}

/** Fallback de GitHub CLI en Windows sin winget: el .msi oficial, en modo silencioso — puede pedir UAC (escribe en Program Files), permitido explícitamente por el usuario, mismo patrón que installAwsCliWindowsMsi(). */
async function installGithubCliWindowsMsi(log: InstallLogger): Promise<void> {
  log('Resolviendo la última versión de GitHub CLI (api.github.com/repos/cli/cli/releases/latest) ...');
  const { tag_name: tagName } = await fetchJson<{ tag_name: string }>(
    'https://api.github.com/repos/cli/cli/releases/latest',
    { 'User-Agent': 'mtg-desktop-runner' },
  );
  const version = tagName.replace(/^v/, '');
  const msiPath = path.join(os.tmpdir(), `gh_${version}_windows_amd64_${Date.now()}.msi`);
  try {
    await download(`https://github.com/cli/cli/releases/download/${tagName}/gh_${version}_windows_amd64.msi`, msiPath, log);
    log('Instalando GitHub CLI (instalador oficial .msi, silencioso) — puede aparecer el diálogo de permiso de administrador de Windows ...');
    await runAndStream('msiexec', ['/i', msiPath, '/qn', '/norestart'], os.tmpdir(), log);
  } finally {
    fs.rmSync(msiPath, { force: true });
  }
  log('GitHub CLI instalado. Puede hacer falta reabrir esta app para que tome el PATH actualizado.');
}

export async function installGithubCli(log: InstallLogger): Promise<void> {
  if (process.platform === 'win32') {
    if (await commandExists('winget')) {
      await installViaWinget('GitHub.cli', log);
      return;
    }
    await installGithubCliWindowsMsi(log);
    return;
  }
  await installGithubCliLinux(log);
}

/** Dispatcher único — scripts.service.ts lo llama sin tener que conocer las 4 funciones de arriba una por una. */
export async function installTool(target: ToolInstallTarget, log: InstallLogger): Promise<void> {
  if (target === 'terraform') return installTerraform(log);
  if (target === 'aws-cli') return installAwsCli(log);
  if (target === 'gh') return installGithubCli(log);
  return installSessionManagerPlugin(log);
}
