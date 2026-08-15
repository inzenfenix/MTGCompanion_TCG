import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { detectGpu } from './gpu-detect';
import { CERTAMEN_DIR } from './scripts.config';

/**
 * Integra a la UI el escape hatch manual documentado en
 * `desktop-runner/docker/tf-rocm/` (ROADMAP.md workstream D) — mismos
 * flags, misma imagen, mismos gotchas ya encontrados y resueltos ahí
 * (sanitizar requirements.txt antes de instalar, GIDs numéricos, volumen de
 * pip cache en vez de bind mount). Este módulo es la versión "callable desde
 * el server" de ese script de bash; `docker/tf-rocm/run.sh` sigue existiendo
 * tal cual para quien prefiera la terminal — no se duplican decisiones de
 * diseño, solo la mecánica.
 */

export const TF_DOCKER_BASE_IMAGE = 'rocm/tensorflow:rocm7.1.1-py3.12-tf2.20-dev';
/** Imagen derivada, armada una sola vez (ensureTfDockerImage en scripts.service.ts) con los paquetes del proyecto ya instalados — así correr un script no reinstala nada cada vez. */
export const TF_DOCKER_READY_IMAGE = 'mtg-tf-rocm-ready:latest';
export const TF_DOCKER_SETUP_CONTAINER = 'mtg-tf-rocm-setup';

// CERTAMEN_DIR = .../Proyecto/certamen_1 — la raíz del repo está dos niveles arriba.
export const REPO_ROOT = path.resolve(CERTAMEN_DIR, '..', '..');
export const TF_REQUIREMENTS_REL_PATH = 'Proyecto/certamen_1/tensorFlow/requirements.txt';

/**
 * Genera el requirements.txt "sin tensorflow" al vuelo dentro del contenedor
 * e instala sobre eso. Ver docker/tf-rocm/README.md § "Known gotchas" para
 * el porqué exacto: `tensorflow>=2.16` sin pin no reconoce el string de
 * versión no-PEP440 de la imagen (`2.20.0-dev0+selfbuilt`) como que la
 * satisface, y pip se baja el wheel CPU-only de PyPI encima rompiendo el
 * import; `optuna-integration[tfkeras]` arrastra el mismo problema por su
 * propio extra (que solo pide "tensorflow" sin versión, confirmado contra
 * los metadatos de PyPI). Mismo filtro que `run.sh`.
 */
export function buildSanitizedInstallCommand(requirementsRelPath: string): string {
  return (
    `sed -E "/^tensorflow/Id; s/optuna-integration\\[tfkeras\\]/optuna-integration/" "${requirementsRelPath}" ` +
    `> /tmp/requirements-sin-tf.txt && pip install --quiet -r /tmp/requirements-sin-tf.txt`
  );
}

function probeCommand(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args);
    } catch {
      resolve(false);
      return;
    }
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    child.on('error', () => done(false));
    child.on('exit', (code) => done(code === 0));
  });
}

export function isDockerInstalled(): Promise<boolean> {
  return probeCommand('docker', ['--version']);
}

export function isImagePresent(tag: string): Promise<boolean> {
  return probeCommand('docker', ['image', 'inspect', tag]);
}

export interface TfDockerEligibility {
  eligible: boolean;
  dockerInstalled: boolean;
  /** null si eligible, explica por qué no si no lo es (se muestra tal cual en la UI). */
  reason: string | null;
}

/**
 * Elegible = Linux + GPU AMD con ROCm funcionando (mismo criterio que
 * gpu-detect.ts para PyTorch) + Docker instalado. Windows/macOS quedan
 * afuera siempre, no solo "no detectado" — ver docker/tf-rocm/README.md
 * § Windows: AMD excluye del soporte ROCm a los SKUs móviles de RDNA2
 * (RX 6800S/6700S y el resto de la línea *M) en cualquier plataforma, así
 * que no tiene sentido ni intentarlo ahí.
 */
export async function getTfDockerEligibility(): Promise<TfDockerEligibility> {
  if (process.platform !== 'linux') {
    return { eligible: false, dockerInstalled: false, reason: 'Solo Linux — en Windows/macOS no hay passthrough de GPU AMD para Docker.' };
  }
  const gpu = await detectGpu();
  if (gpu.backend !== 'rocm') {
    return {
      eligible: false,
      dockerInstalled: false,
      reason: gpu.backend === 'cuda' ? 'GPU NVIDIA detectada — PyTorch/TensorFlow ya usan CUDA directo, esto es solo para AMD.' : 'No se detectó una GPU AMD con ROCm funcionando (rocminfo/`/dev/kfd`).',
    };
  }
  const dockerInstalled = await isDockerInstalled();
  if (!dockerInstalled) {
    return { eligible: false, dockerInstalled: false, reason: 'GPU AMD con ROCm detectada, pero Docker no está instalado en este equipo.' };
  }
  return { eligible: true, dockerInstalled: true, reason: null };
}

export function isTfDockerImageReady(): Promise<boolean> {
  return isImagePresent(TF_DOCKER_READY_IMAGE);
}

function hostGroupGid(name: string): number | null {
  try {
    const content = fs.readFileSync('/etc/group', 'utf-8');
    for (const line of content.split('\n')) {
      const parts = line.split(':');
      if (parts[0] === name && parts[2]) return parseInt(parts[2], 10);
    }
  } catch {
    // /etc/group no legible por algún motivo — se sigue sin ese --group-add.
  }
  return null;
}

/**
 * Arma el argv completo de `docker run` para correr un script dentro de la
 * imagen ya preparada, con la GPU pasada — mismos flags que
 * `docker/tf-rocm/run.sh`, confirmados funcionando en el spike de D1 (ver
 * ROADMAP.md workstream D):
 *  - --group-add por GID numérico, no por nombre (la imagen no tiene un
 *    grupo "video"/"render" propio).
 *  - --ipc=host + --shm-size=8g (TF/XLA usan shared memory agresivamente).
 *  - -e HSA_OVERRIDE_GFX_VERSION solo si gpu-detect.ts lo pidió (opt-in,
 *    nunca hardcodeado — CLAUDE.md regla 1).
 * No incluye -it: esto lo lanza el server vía child_process.spawn, sin TTY.
 */
export function buildTfDockerRunArgs(scriptRelPath: string, scriptArgv: string[], hsaOverrideGfxVersion: string | null): string[] {
  const args: string[] = ['run', '--rm', '--device=/dev/kfd', '--device=/dev/dri'];

  const videoGid = hostGroupGid('video');
  const renderGid = hostGroupGid('render');
  if (videoGid !== null) args.push('--group-add', String(videoGid));
  if (renderGid !== null) args.push('--group-add', String(renderGid));

  args.push('--ipc=host', '--shm-size=8g', '--security-opt', 'seccomp=unconfined');
  args.push('-v', `${REPO_ROOT}:/workspace`, '-w', '/workspace');
  if (hsaOverrideGfxVersion) args.push('-e', `HSA_OVERRIDE_GFX_VERSION=${hsaOverrideGfxVersion}`);

  args.push(TF_DOCKER_READY_IMAGE, 'python', '-u', scriptRelPath, ...scriptArgv);
  return args;
}
