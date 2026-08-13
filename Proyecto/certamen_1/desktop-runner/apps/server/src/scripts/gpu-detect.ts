import { spawn } from 'child_process';
import * as fs from 'fs';

export type GpuBackend = 'cuda' | 'rocm' | 'cpu';

export interface GpuDetectionResult {
  backend: GpuBackend;
  vendor: 'nvidia' | 'amd' | 'none';
  deviceName: string | null;
  /**
   * Canales de wheels de PyTorch a probar en orden cuando backend === 'rocm'
   * (el primero que instale sin error, gana). Cubre distintas versiones de
   * ROCm de sistema sin tener que parsear la versión exacta instalada.
   */
  rocmChannels: string[];
  /**
   * HSA_OVERRIDE_GFX_VERSION a exportar al correr scripts de este env, si la
   * GPU detectada no tiene kernels ROCm precompilados oficialmente (típico
   * en variantes móviles de RDNA2, ej. RX 6800S/6700S). null = no hace falta.
   */
  hsaOverrideGfxVersion: string | null;
  /** Explicación en texto plano, para mostrar en la UI y loguear durante la instalación. */
  notes: string[];
}

// gfx targets de GPUs AMD que existen en runtime (rocminfo las detecta) pero
// no tienen kernels precompilados en los wheels oficiales de PyTorch/ROCm —
// principalmente variantes móviles de RDNA2. Se resuelven aliasando al gfx
// de escritorio ISA-compatible más cercano (gfx1030 = Navi 21 desktop).
// Ver desktop-runner/README.md § "GPU AMD / ROCm" para el detalle medido en
// una RX 6800S (gfx1032) real.
const GFX_OVERRIDES: Record<string, string> = {
  gfx1031: '10.3.0',
  gfx1032: '10.3.0',
  gfx1034: '10.3.0',
  gfx1035: '10.3.0',
  gfx1036: '10.3.0',
};

function run(cmd: string, args: string[], timeoutMs = 5000): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args);
    } catch {
      resolve({ ok: false, stdout: '' });
      return;
    }
    let stdout = '';
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ ok, stdout });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, timeoutMs);
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.on('error', () => {
      clearTimeout(timer);
      finish(false);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      finish(code === 0);
    });
  });
}

async function detectNvidia(): Promise<GpuDetectionResult | null> {
  const res = await run('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader']);
  const name = res.stdout.trim().split('\n')[0]?.trim();
  if (!res.ok || !name) return null;

  return {
    backend: 'cuda',
    vendor: 'nvidia',
    deviceName: name,
    rocmChannels: [],
    hsaOverrideGfxVersion: null,
    notes: [`GPU NVIDIA detectada: ${name} — se instalan los wheels default de PyPI (ya traen soporte CUDA).`],
  };
}

async function detectAmd(): Promise<GpuDetectionResult | null> {
  // Los wheels ROCm de PyTorch (download.pytorch.org/whl/rocmX.Y) son solo
  // Linux. En Windows/macOS con GPU AMD no hay wheel que instalar: CPU.
  if (process.platform !== 'linux') return null;
  // Sin /dev/kfd no está ni el driver de kernel (amdgpu/ROCk) — sin eso
  // rocminfo tampoco va a encontrar nada, y no vale la pena intentarlo.
  if (!fs.existsSync('/dev/kfd')) return null;

  const res = await run('rocminfo', []);
  if (!res.ok) return null;

  // rocminfo lista un "Agent" por CPU y por GPU. Nos interesa el primer
  // agent con "Vendor Name: AMD" (el de la CPU dice "Vendor Name: CPU").
  const blocks = res.stdout.split(/(?=^Agent \d+)/m).slice(1);
  for (const block of blocks) {
    const vendor = block.match(/Vendor Name:\s*(\S+)/)?.[1];
    if (vendor !== 'AMD') continue;

    const marketingName = block.match(/Marketing Name:\s*(.+)/)?.[1]?.trim();
    // El primer "Name:" del bloque es el gfx target (ej. "gfx1032"); los que
    // vienen después bajo "ISA Info" tienen prefijo (ej. "amdgcn-amd-amdhsa--gfx1032")
    // y no matchean este regex a propósito.
    const gfx = block.match(/^\s*Name:\s*(gfx[0-9a-fA-F]+)\s*$/m)?.[1] ?? null;
    if (!marketingName) continue;

    const notes = [`GPU AMD detectada: ${marketingName}${gfx ? ` (${gfx})` : ''}.`];
    const override = gfx ? (GFX_OVERRIDES[gfx] ?? null) : null;
    if (override) {
      notes.push(
        `"${gfx}" no tiene kernels ROCm precompilados oficialmente — se corre con HSA_OVERRIDE_GFX_VERSION=${override} ` +
          `(alias a la variante de escritorio ISA-compatible más cercana).`,
      );
    }

    return {
      backend: 'rocm',
      vendor: 'amd',
      deviceName: marketingName,
      rocmChannels: ['rocm7.1', 'rocm6.4', 'rocm6.2'],
      hsaOverrideGfxVersion: override,
      notes,
    };
  }

  return null;
}

let cached: Promise<GpuDetectionResult> | null = null;

/**
 * Detecta GPU una sola vez por proceso (resultado cacheado): NVIDIA primero
 * (CUDA — sin instalación especial, los wheels default ya sirven), después
 * AMD (ROCm — solo Linux, requiere /dev/kfd + rocminfo), y si ninguna
 * aparece, CPU. Usado tanto al preparar un venv (elige qué instalar) como al
 * correr un script (decide si hace falta setear HSA_OVERRIDE_GFX_VERSION).
 */
export function detectGpu(): Promise<GpuDetectionResult> {
  if (!cached) {
    cached = (async () => {
      const nvidia = await detectNvidia();
      if (nvidia) return nvidia;

      const amd = await detectAmd();
      if (amd) return amd;

      return {
        backend: 'cpu',
        vendor: 'none',
        deviceName: null,
        rocmChannels: [],
        hsaOverrideGfxVersion: null,
        notes: ['No se detectó GPU NVIDIA ni AMD utilizable (o falta el driver/CLI correspondiente) — modo CPU.'],
      };
    })();
  }
  return cached;
}
