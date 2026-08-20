import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  ArgDef,
  ComparableFramework,
  ENVS,
  EnvDef,
  EnvId,
  EXPORT_STAGES,
  LiveFileDef,
  ResultFileDef,
  RUN_ALL_DOWNLOAD_SEQUENCE,
  RUN_ALL_EXPORT_SEQUENCE,
  RUN_ALL_SEQUENCES,
  ScriptDef,
  SCRIPTS,
  findScript,
} from './scripts.config';
import { LogsGateway } from './logs.gateway';
import { detectGpu, GpuDetectionResult } from './gpu-detect';
import { getScraperCardCount, ScraperCardCountResult } from './scryfall-card-count';
import { readSettings, writeSettings, RunnerSettings, AwsCredentials, AwsServicesChecklist } from './settings';
import { buildAwsCliEnv, getTerraformEligibility, TERRAFORM_DIR, TerraformAction, TerraformEligibility } from './terraform';
import { installTool as installToolBinary, pathEnvWithToolBin, ToolInstallTarget } from './tool-install';
import {
  buildPortForwardArgs,
  buildStartSessionArgs,
  isSessionManagerPluginInstalled,
  launchNativeTerminal,
  runSsmCommand,
  SSM_INSTANCES,
  SsmInstanceKey,
} from './ssm';
import { applyBackendUrl, ApplyBackendUrlResult, resolveAndroidJavaHome, TRADING_APP_DIR } from './android-deploy';
import {
  buildSanitizedInstallCommand,
  buildTfDockerRunArgs,
  getTfDockerEligibility,
  isTfDockerImageReady,
  REPO_ROOT,
  TF_DOCKER_BASE_IMAGE,
  TF_DOCKER_READY_IMAGE,
  TF_DOCKER_SETUP_CONTAINER,
  TF_REQUIREMENTS_REL_PATH,
  TfDockerEligibility,
} from './tf-docker';

// ROADMAP.md I39 — the real deployed backend instance only has ~2GB RAM; a
// single `ts-node` process handling all 58,679 catalog rows in one go ran
// V8 out of heap around row 24,000 (confirmed live via
// `aws ssm get-command-invocation`'s real stderr). `importCatalog()` below
// now runs `IMPORT_CATALOG_CHUNKS` separate `ts-node` invocations, each a
// fresh process/fresh heap covering `IMPORT_CATALOG_CHUNK_SIZE` rows
// (`import-catalog.ts`'s own `--offset`/`--limit` flags). Product must
// comfortably exceed the real card count (58,679 as of this writing) —
// bump `IMPORT_CATALOG_CHUNKS` if a future re-scrape grows the catalog
// past what this covers (a chunk whose offset exceeds the real row count
// just processes 0 rows, harmless but wasted work, not an error).
const IMPORT_CATALOG_CHUNK_SIZE = 10000;
const IMPORT_CATALOG_CHUNKS = 6;

export interface RunRecord {
  id: string;
  scriptId: string;
  status: 'running' | 'success' | 'error' | 'stopped';
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
}

export interface RunAllStepResult {
  scriptId: string;
  label: string;
  runId: string;
  status: 'success' | 'error' | 'stopped';
  exitCode: number | null;
  durationMs: number;
}

@Injectable()
export class ScriptsService {
  private readonly logger = new Logger(ScriptsService.name);
  private readonly runs = new Map<string, RunRecord>();
  private readonly children = new Map<string, ChildProcessWithoutNullStreams>();
  private readonly stopRequested = new Set<string>();
  private readonly livePollers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly gateway: LogsGateway) {}

  // ── Listado / estado ────────────────────────────────────────────────────

  async listScripts() {
    return Promise.all(
      SCRIPTS.map(async (s) => ({
        id: s.id,
        group: s.group,
        label: s.label,
        description: s.description,
        env: s.env,
        args: s.args,
        venvReady: await this.scriptEnvReady(s),
      })),
    );
  }

  /**
   * "¿Está listo para correr AHORA MISMO?" para un script — a diferencia de
   * venvReady() (que es puramente "¿existe el venv?"), acá "tensorflow" mira
   * el modo elegido: en modo 'docker' lo que importa es si la imagen está
   * armada, el venv es irrelevante (puede no existir y está bien) — salvo
   * para scripts de export (ver usesDocker()), que siempre corren por venv.
   * Usado por listScripts() (banner "faltan entornos" en App.tsx) y por
   * runScript() para decidir por dónde efectivamente correr.
   */
  private async scriptEnvReady(script: ScriptDef): Promise<boolean> {
    if (script.env === 'system') return true;
    if (await this.usesDocker(script)) return isTfDockerImageReady();
    return this.venvReady(script.env);
  }

  private async tensorflowUsesDocker(): Promise<boolean> {
    if (readSettings().tensorflowExecutionMode !== 'docker') return false;
    return (await getTfDockerEligibility()).eligible;
  }

  /**
   * Scripts `*_export_onnx*.py` (convención de CLAUDE.md regla 3) nunca
   * corren en Docker, sin importar `tensorflowExecutionMode` — no ganan nada
   * de la GPU (son un load de checkpoint + un par de forward passes de
   * verificación, no un training loop; D3 en ROADMAP.md ya midió que CPU es
   * más rápido que Docker/GPU incluso para el entrenamiento de modelos
   * chicos) y sí pueden perder: la imagen Docker puede traer una versión de
   * Keras más vieja que la del venv que guardó el checkpoint, y un Keras
   * viejo no sabe leer configs de capas guardadas por uno más nuevo — falla
   * con `Unrecognized keyword arguments passed to Dense: {'quantization_config': ...}`
   * (ver ROADMAP.md workstream D, item D4, encontrado corriendo el export
   * real de Stage 2 en modo Docker). Forzar venv acá evita esa clase de bug
   * de raíz para exports, sin tocar el setting global (que sigue aplicando
   * normalmente a entrenar/Optuna, donde si puede valer la pena la GPU).
   */
  private async usesDocker(script: ScriptDef): Promise<boolean> {
    if (script.env !== 'tensorflow') return false;
    if (script.script.includes('export_onnx')) return false;
    return this.tensorflowUsesDocker();
  }

  async listEnvs(): Promise<{ id: string; label: string; needsVenv: boolean; ready: boolean }[]> {
    const envs = Object.values(ENVS).map((e) => ({
      id: e.id as string,
      label: e.label,
      needsVenv: e.dir !== null,
      ready: this.venvReady(e.id),
    }));

    // Fila extra "TensorFlow — Docker (ROCm)", solo si esta máquina es
    // elegible (Linux + AMD/ROCm + Docker instalado) — en cualquier otra
    // máquina ni aparece, no hace falta que la UI la esconda a mano.
    // Reutiliza exactamente el mismo flujo "Preparar" que un venv (mismo
    // botón, mismo panel de progreso vía WebSocket) — ver ensureVenv().
    const tfDockerEligibility = await getTfDockerEligibility();
    if (tfDockerEligibility.eligible) {
      envs.push({
        id: 'tensorflow-docker',
        label: 'TensorFlow — GPU vía Docker (ROCm)',
        needsVenv: true,
        ready: await isTfDockerImageReady(),
      });
    }

    return envs;
  }

  getTfDockerStatus(): Promise<TfDockerEligibility & { imageTag: string; imageReady: boolean }> {
    return Promise.all([getTfDockerEligibility(), isTfDockerImageReady()]).then(([eligibility, imageReady]) => ({
      ...eligibility,
      imageTag: TF_DOCKER_BASE_IMAGE,
      imageReady,
    }));
  }

  getSettings(): RunnerSettings {
    return readSettings();
  }

  updateSettings(patch: Partial<RunnerSettings>): RunnerSettings {
    if (patch.tensorflowExecutionMode !== undefined && patch.tensorflowExecutionMode !== 'venv' && patch.tensorflowExecutionMode !== 'docker') {
      throw new BadRequestException(`tensorflowExecutionMode inválido: "${patch.tensorflowExecutionMode}"`);
    }
    if (patch.roboflowApiKey !== undefined && patch.roboflowApiKey !== null && typeof patch.roboflowApiKey !== 'string') {
      throw new BadRequestException('roboflowApiKey inválida: debe ser string o null.');
    }
    if (patch.awsCredentials !== undefined && patch.awsCredentials !== null) {
      const c = patch.awsCredentials;
      if (typeof c.accessKeyId !== 'string' || typeof c.secretAccessKey !== 'string' || (c.sessionToken !== null && typeof c.sessionToken !== 'string')) {
        throw new BadRequestException('awsCredentials inválidas: se espera { accessKeyId, secretAccessKey, sessionToken }.');
      }
      // savedAt lo pone el server, no el cliente — así "guardado hace Xh" (la
      // pista de staleness en la UI) no depende de que el reloj del cliente
      // esté bien puesto.
      patch.awsCredentials = { ...c, savedAt: Date.now() };
    }
    if (patch.awsServicesChecklist !== undefined) {
      const keys: (keyof AwsServicesChecklist)[] = ['ec2', 's3', 'secretsManager', 'sns', 'sqs', 'dynamodb', 'cognito', 'useMinio'];
      const invalid = keys.some((k) => typeof patch.awsServicesChecklist?.[k] !== 'boolean');
      if (invalid) throw new BadRequestException('awsServicesChecklist inválido: se espera un boolean por cada servicio.');
    }
    return writeSettings(patch);
  }

  getRun(runId: string): RunRecord {
    const run = this.runs.get(runId);
    if (!run) throw new NotFoundException(`No existe la corrida ${runId}`);
    return run;
  }

  getGpuInfo(): Promise<GpuDetectionResult> {
    return detectGpu();
  }

  /** Total real (aproximado) del catálogo de Scryfall que sobrevive los filtros de 01_scraper.py — ver scryfall-card-count.ts. */
  getScraperCardCount(): Promise<ScraperCardCountResult> {
    return getScraperCardCount();
  }

  // ── Comparación PyTorch vs TensorFlow (pestaña "Exportar") ─────────────

  /**
   * Por cada etapa dual-framework (Stage 1, Stage 4), lee final_metrics.json
   * de ambos frameworks (si existen) y arma una recomendación. Nunca tira:
   * un modelo sin entrenar en esta máquina se reporta como
   * `available: false`, no como error — mismo criterio de degradación
   * gradual que el resto del runner (ej. venv no preparado).
   */
  async getExportComparison() {
    const frameworks: ComparableFramework[] = ['pytorch', 'tensorflow'];

    return Promise.all(
      EXPORT_STAGES.map(async (stageDef) => {
        const byFramework: Record<ComparableFramework, { available: boolean; metrics?: Record<string, unknown>; exportScriptId: string }> =
          {} as any;

        for (const fw of frameworks) {
          const exportScriptId = stageDef.exportScriptId(fw);
          try {
            const resolvedPath = await this.resolveLatestPath(stageDef.metricsPath(fw));
            const raw = await fs.promises.readFile(resolvedPath, 'utf-8');
            byFramework[fw] = { available: true, metrics: JSON.parse(raw), exportScriptId };
          } catch {
            // No existe todavía (no se corrió Optuna con entrenamiento final
            // en esta máquina) — no es un error, solo "no entrenado todavía".
            byFramework[fw] = { available: false, exportScriptId };
          }
        }

        const a = byFramework.pytorch.available ? this.readMetric(byFramework.pytorch.metrics, stageDef.metricKey) : undefined;
        const b = byFramework.tensorflow.available ? this.readMetric(byFramework.tensorflow.metrics, stageDef.metricKey) : undefined;

        let recommendation: 'pytorch' | 'tensorflow' | 'tie' | null = null;
        if (typeof a === 'number' && typeof b === 'number') {
          // Diferencia menor a 0.5 puntos porcentuales: se reporta empate en
          // vez de forzar un "ganador" que en la práctica es ruido de
          // entrenamiento (ver Stage 1 en el README: ambos ~100%).
          const diff = Math.abs(a - b);
          recommendation = diff < 0.005 ? 'tie' : a > b ? 'pytorch' : 'tensorflow';
        } else if (typeof a === 'number') {
          recommendation = 'pytorch';
        } else if (typeof b === 'number') {
          recommendation = 'tensorflow';
        }

        return {
          stage: stageDef.stage,
          label: stageDef.label,
          metricKey: stageDef.metricKey,
          metricLabel: stageDef.metricLabel,
          format: stageDef.format ?? 'percent',
          pytorch: byFramework.pytorch,
          tensorflow: byFramework.tensorflow,
          recommendation,
        };
      }),
    );
  }

  /**
   * Lee `metricKey` de `metrics`, con soporte para paths con puntos
   * (ej. "log_space.r2") — Stage 3 anida sus métricas por espacio
   * (log_space/usd_space, ver 15_price_estimator.py), a diferencia de las
   * keys planas (accuracy/roc_auc/f1_macro) que usan Stage 1/2/4.
   */
  private readMetric(metrics: Record<string, unknown> | undefined, metricKey: string): number | undefined {
    const value = metricKey.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), metrics);
    return typeof value === 'number' ? value : undefined;
  }

  // ── Resolución de intérpretes / venvs ──────────────────────────────────

  private venvPythonPath(envId: EnvId): string | null {
    const env = ENVS[envId];
    if (!env.dir) return null;
    const venvDir = path.join(env.dir, '.venv');
    const winPy = path.join(venvDir, 'Scripts', 'python.exe');
    const nixPy = path.join(venvDir, 'bin', 'python');
    return process.platform === 'win32' ? winPy : nixPy;
  }

  /**
   * Marca que un venv terminó de instalarse (venv creado Y requirements.txt
   * instalado sin error), no solo que existe. Se escribe al final de
   * ensureVenv() — si esa promesa nunca resuelve (falla a mitad de camino),
   * el marker no existe y venvReady() sigue reportando false. Sin esto, un
   * venv a medio instalar (ej. python -m venv corrió pero pip falló) se veía
   * como "listo" en la UI porque el binario de python ya existía.
   */
  private venvMarkerPath(envId: EnvId): string | null {
    const env = ENVS[envId];
    if (!env.dir) return null;
    return path.join(env.dir, '.venv', '.mtg-runner-ready');
  }

  private venvReady(envId: EnvId): boolean {
    if (envId === 'system') return true;
    const py = this.venvPythonPath(envId);
    const marker = this.venvMarkerPath(envId);
    return !!py && !!marker && fs.existsSync(py) && fs.existsSync(marker);
  }

  /** Devuelve el comando de python a usar para un env, asegurando el venv si hace falta. */
  private async resolvePython(envId: EnvId): Promise<string> {
    if (envId === 'system') return this.systemPython();
    if (!this.venvReady(envId)) {
      await this.ensureVenv(envId);
    }
    const py = this.venvPythonPath(envId);
    if (!py || !fs.existsSync(py)) {
      throw new BadRequestException(`No se pudo preparar el venv de "${envId}".`);
    }
    return py;
  }

  private systemPythonCache: string | null = null;

  private systemPython(): string {
    if (this.systemPythonCache) return this.systemPythonCache;
    // En la mayoría de instalaciones modernas "python3" existe en Unix y "python" en Windows.
    this.systemPythonCache = process.platform === 'win32' ? 'python' : 'python3';
    return this.systemPythonCache;
  }

  /** true si `cmd --version` corre sin error (existe y es ejecutable). */
  private probeCommand(cmd: string): Promise<boolean> {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(cmd, ['--version']);
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

  /** Corre `cmd args` y devuelve su stdout (trimmed), o null si falló/salió con código != 0. */
  private runCaptureStdout(cmd: string, args: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(cmd, args);
      } catch {
        resolve(null);
        return;
      }
      let out = '';
      child.stdout?.on('data', (d) => (out += d.toString()));
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok ? out.trim() : null);
      };
      child.on('error', () => done(false));
      child.on('exit', (code) => done(code === 0));
    });
  }

  /**
   * Fallback para cuando ningún candidato de preferredPythonBins existe como
   * comando suelto en PATH — el caso en distros que solo empaquetan UN
   * python3 del sistema (Arch/CachyOS: pacman da python3.14 y nada más, a
   * diferencia de Debian/Fedora que empaquetan python3.12/3.11/etc. por
   * separado). Ahí la forma real de tener un Python más viejo sin sudo es
   * pyenv — y en Arch/CachyOS viene empaquetado en /usr/bin/pyenv, no hace
   * falta ni el shell-init habitual (sus shims en PATH) para invocarlo.
   *
   * Busca, entre las versiones que pyenv ya tiene instaladas (`pyenv
   * versions --bare`), la más alta que matchee alguno de los candidatos
   * (ej. "python3.12" -> prefijo "3.12."), en el mismo orden de preferencia,
   * y devuelve la ruta absoluta a su binario (`<pyenv root>/versions/<v>/bin/python`).
   * null si pyenv no está instalado o no tiene ninguna versión que sirva —
   * en ese caso el llamador cae al python del sistema, mismo comportamiento
   * que antes de que existiera este fallback.
   */
  private async resolvePyenvPython(candidates: string[]): Promise<string | null> {
    if (!(await this.probeCommand('pyenv'))) return null;

    const root = await this.runCaptureStdout('pyenv', ['root']);
    const rawVersions = await this.runCaptureStdout('pyenv', ['versions', '--bare']);
    if (!root || !rawVersions) return null;

    // "--bare" también lista virtualenvs (ej. "3.12.9/envs/tf-env") y sus
    // alias sin versión (ej. "tf-env") — nos quedamos solo con instalaciones
    // reales "X.Y.Z" (Pythons de verdad, no un venv armado adentro de uno).
    const installed = rawVersions
      .split('\n')
      .map((v) => v.trim())
      .filter((v) => /^\d+\.\d+\.\d+$/.test(v));

    for (const candidate of candidates) {
      const minorPrefix = candidate.replace(/^python/, ''); // "python3.12" -> "3.12"
      const matches = installed
        .filter((v) => v.startsWith(`${minorPrefix}.`))
        .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // el patch más alto primero
      if (matches.length > 0) {
        return path.join(root, 'versions', matches[0], 'bin', 'python');
      }
    }
    return null;
  }

  /**
   * Python a usar para CREAR el venv de un env (no para correrlo después —
   * una vez creado, siempre se usa el intérprete de adentro del venv). Prueba
   * env.preferredPythonBins en orden (ver el comentario en scripts.config.ts)
   * como comando suelto en PATH primero (Debian/Fedora: cada versión es su
   * propio paquete, ej. "python3.12" ya está en PATH). Si ninguno existe así,
   * prueba el fallback de pyenv (resolvePyenvPython, ver ahí — cubre
   * Arch/CachyOS y cualquier otra distro que solo dé un python3 del sistema).
   * Si tampoco, cae al python genérico del sistema.
   */
  private async resolveCreationPython(env: EnvDef, envId?: EnvId): Promise<string> {
    const candidates = env.preferredPythonBins ?? [];
    for (const candidate of candidates) {
      if (await this.probeCommand(candidate)) return candidate;
    }
    if (candidates.length > 0) {
      const viaPyenv = await this.resolvePyenvPython(candidates);
      if (viaPyenv) {
        if (envId) this.gateway.emitVenvProgress(envId, `Ninguno de ${candidates.join('/')} está en PATH — usando ${viaPyenv} (vía pyenv).`);
        return viaPyenv;
      }
    }
    return this.systemPython();
  }

  /**
   * Crea el venv de un entorno (si falta) e instala su requirements.txt.
   * Streamea progreso por WebSocket bajo el runId sintético "venv:<envId>".
   *
   * Si venvReady() da false pero la carpeta .venv YA existe (instalación
   * previa a medias, o creada con otro intérprete — ej. un reintento después
   * de que preferredPythonBins cambiara), se borra entera antes de crear de
   * nuevo. Nada de intentar reutilizarla: `python -m venv` sobre un venv
   * existente no pisa symlinks que ya estén (bin/python, bin/pip) aunque se
   * le pida un intérprete distinto — pip terminaba instalando en el Python
   * nuevo mientras bin/python seguía apuntando al viejo, dos "venv" pisados
   * uno sobre otro sin que ningún comando fallara. Reinstalar de cero es
   * barato igual: pip ya tiene todo cacheado localmente.
   */
  async ensureVenv(envId: EnvId | 'tensorflow-docker'): Promise<void> {
    if (envId === 'tensorflow-docker') return this.ensureTfDockerImage();

    const env = ENVS[envId];
    // El :envId de la ruta es un string cualquiera en runtime — el tipo EnvId
    // no lo garantiza. Sin este chequeo, un id inválido revienta accediendo
    // a env.dir de "undefined" y sale como 500 "Internal server error" en
    // vez de un 400 con un mensaje que diga qué pasó.
    if (!env) throw new BadRequestException(`Entorno desconocido: "${envId}"`);
    if (!env.dir || !env.requirementsFile) return; // 'system': nada que preparar

    const runId = `venv:${envId}`;
    const venvDir = path.join(env.dir, '.venv');

    if (this.venvReady(envId)) {
      this.gateway.emitVenvProgress(envId, 'venv ya existe, nada que hacer.');
      return;
    }

    if (!fs.existsSync(env.requirementsFile)) {
      throw new BadRequestException(`No se encontró ${env.requirementsFile}`);
    }

    this.gateway.emitStatus(runId, 'running');

    try {
      if (fs.existsSync(venvDir)) {
        this.gateway.emitVenvProgress(envId, `Venv anterior incompleto en ${venvDir} — se borra antes de reinstalar ...`);
        fs.rmSync(venvDir, { recursive: true, force: true });
      }

      const creationPython = await this.resolveCreationPython(env, envId);
      this.gateway.emitVenvProgress(envId, `Creando venv en ${venvDir} (${creationPython}) ...`);
      await this.execAndStream(runId, creationPython, ['-m', 'venv', venvDir], env.dir);

      const pip =
        process.platform === 'win32'
          ? path.join(venvDir, 'Scripts', 'pip.exe')
          : path.join(venvDir, 'bin', 'pip');

      // pytorch/tensorflow: instalar el paquete GPU-aware ANTES de requirements.txt,
      // para que requirements.txt (que solo pide "torch>=2.11"/"tensorflow>=2.16")
      // vea la versión ya instalada, la de más arriba gana, y no la pise con el wheel
      // default de PyPI. testing/system no tocan GPU — no llevan torch/tensorflow.
      if (envId === 'pytorch' || envId === 'tensorflow') {
        await this.installGpuAwarePackage(envId, runId, pip, env.dir);
      }

      this.gateway.emitVenvProgress(envId, `Instalando dependencias desde ${path.basename(env.requirementsFile)} ...`);
      await this.execAndStream(runId, pip, ['install', '-r', env.requirementsFile], env.dir);

      const marker = this.venvMarkerPath(envId);
      if (marker) fs.writeFileSync(marker, JSON.stringify({ createdAt: new Date().toISOString(), python: creationPython }));

      this.gateway.emitVenvProgress(envId, 'Listo.');
      this.gateway.emitStatus(runId, 'success');
    } catch (err) {
      // Sin este catch, la excepción se iba sin loguear un mensaje claro por
      // WebSocket y llegaba al cliente como un 500 "Internal server error"
      // genérico (el filtro default de Nest no expone el motivo real) — acá
      // se manda el motivo real por los dos canales: log en vivo y la
      // respuesta HTTP que ve quien llamó a POST /envs/:envId/ensure.
      const message = err instanceof Error ? err.message : String(err);
      this.gateway.emitVenvProgress(envId, `Falló: ${message}`);
      this.gateway.emitStatus(runId, 'error');
      throw new BadRequestException(`No se pudo preparar el venv de "${envId}": ${message}`);
    }
  }

  /**
   * Detecta GPU (NVIDIA/AMD/ninguna) e instala el wheel de torch/tensorflow
   * que corresponda ANTES del resto de requirements.txt:
   *  - NVIDIA: nada especial — el wheel default de PyPI ya trae soporte CUDA.
   *  - AMD (ROCm, solo Linux): prueba los canales de gpu-detect.ts en orden
   *    (rocm7.1 → rocm6.4 → rocm6.2) hasta que uno instale sin error.
   *    TensorFlow no tiene wheel ROCm mantenido para las versiones que pide
   *    este proyecto (>=2.16) — solo aplica a "pytorch"; para "tensorflow"
   *    con AMD detectado, solo se loguea y se sigue con CPU.
   *  - Ninguna GPU / falló la instalación ROCm: wheels CPU explícitos para
   *    pytorch (más chicos que el default con CUDA sin uso); tensorflow no
   *    tiene índice "cpu" separado, así que ahí no hace falta nada especial.
   * Nunca tira: si todo falla, deja que el requirements.txt de después
   * instale lo que pueda — siempre termina en algo funcional en CPU.
   */
  private async installGpuAwarePackage(envId: 'pytorch' | 'tensorflow', runId: string, pip: string, cwd: string): Promise<void> {
    const gpu = await detectGpu();
    for (const note of gpu.notes) this.gateway.emitVenvProgress(envId, note);

    if (envId === 'tensorflow') {
      if (gpu.backend === 'rocm') {
        this.gateway.emitVenvProgress(
          envId,
          'TensorFlow no tiene wheel ROCm mantenido para tensorflow>=2.16 vía pip (solo Docker) — se instala en modo CPU.',
        );
      }
      return; // TF no tiene índice especial que elegir en ningún caso — lo resuelve requirements.txt.
    }

    // A partir de acá, envId === 'pytorch'.
    if (gpu.backend === 'rocm') {
      for (const channel of gpu.rocmChannels) {
        this.gateway.emitVenvProgress(envId, `Instalando PyTorch (ROCm, canal ${channel}) ...`);
        try {
          await this.execAndStream(
            runId,
            pip,
            ['install', '--index-url', `https://download.pytorch.org/whl/${channel}`, 'torch', 'torchvision'],
            cwd,
          );
          return;
        } catch {
          this.gateway.emitVenvProgress(envId, `Canal ${channel} no funcionó, probando el siguiente ...`);
        }
      }
      this.gateway.emitVenvProgress(envId, 'Ningún canal ROCm funcionó — sigue con CPU.');
      // cae al bloque de abajo (wheels CPU explícitos)
    } else if (gpu.backend === 'cuda') {
      return; // nada que hacer, requirements.txt ya instala el wheel CUDA default
    }

    try {
      this.gateway.emitVenvProgress(envId, 'Instalando PyTorch (CPU) ...');
      await this.execAndStream(runId, pip, ['install', '--index-url', 'https://download.pytorch.org/whl/cpu', 'torch', 'torchvision'], cwd);
    } catch {
      this.gateway.emitVenvProgress(envId, 'No se pudo usar el índice CPU de PyTorch — requirements.txt instala el wheel default.');
    }
  }

  /**
   * Arma (una sola vez) la imagen Docker lista para correr scripts de
   * TensorFlow con GPU AMD — versión "callable desde la UI" del escape
   * hatch manual de `docker/tf-rocm/` (ROADMAP.md workstream D). Tres pasos,
   * cada uno logueado por WebSocket igual que un venv:
   *   1. `docker pull` de la imagen base (~11GB, la parte lenta).
   *   2. Un contenedor de "setup" que instala los paquetes del proyecto
   *      (requirements.txt saneado — ver buildSanitizedInstallCommand).
   *   3. `docker commit` de ese contenedor a un tag propio
   *      (TF_DOCKER_READY_IMAGE), para que correr un script después no
   *      tenga que reinstalar nada — solo un `docker run` directo.
   * Igual que ensureVenv(): si ya está lista, no hace nada.
   */
  private async ensureTfDockerImage(): Promise<void> {
    const envId = 'tensorflow-docker';
    const runId = `venv:${envId}`;

    const eligibility = await getTfDockerEligibility();
    if (!eligibility.eligible) {
      throw new BadRequestException(`No se puede preparar TensorFlow por Docker en este equipo: ${eligibility.reason}`);
    }

    if (await isTfDockerImageReady()) {
      this.gateway.emitVenvProgress(envId, 'La imagen ya está lista, nada que hacer.');
      return;
    }

    this.gateway.emitStatus(runId, 'running');
    try {
      this.gateway.emitVenvProgress(envId, `Descargando ${TF_DOCKER_BASE_IMAGE} (~11GB — solo la primera vez, puede tardar varios minutos) ...`);
      await this.execAndStream(runId, 'docker', ['pull', TF_DOCKER_BASE_IMAGE], REPO_ROOT);

      // Por si quedó un contenedor de setup de un intento anterior fallido —
      // "docker run --name" no pisa uno que ya existe, tira error.
      await new Promise<void>((resolve) => {
        const child = spawn('docker', ['rm', '-f', TF_DOCKER_SETUP_CONTAINER]);
        child.on('close', () => resolve());
        child.on('error', () => resolve());
      });

      this.gateway.emitVenvProgress(envId, 'Instalando las dependencias del proyecto dentro de la imagen (una sola vez) ...');
      await this.execAndStream(
        runId,
        'docker',
        [
          'run',
          '--name',
          TF_DOCKER_SETUP_CONTAINER,
          '-v',
          `${REPO_ROOT}:/workspace`,
          '-w',
          '/workspace',
          TF_DOCKER_BASE_IMAGE,
          'bash',
          '-c',
          buildSanitizedInstallCommand(TF_REQUIREMENTS_REL_PATH),
        ],
        REPO_ROOT,
      );

      this.gateway.emitVenvProgress(envId, 'Guardando la imagen lista para reutilizar ...');
      await this.execAndStream(runId, 'docker', ['commit', TF_DOCKER_SETUP_CONTAINER, TF_DOCKER_READY_IMAGE], REPO_ROOT);
      await this.execAndStream(runId, 'docker', ['rm', TF_DOCKER_SETUP_CONTAINER], REPO_ROOT);

      this.gateway.emitVenvProgress(envId, 'Listo.');
      this.gateway.emitStatus(runId, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.gateway.emitVenvProgress(envId, `Falló: ${message}`);
      this.gateway.emitStatus(runId, 'error');
      throw new BadRequestException(`No se pudo preparar la imagen Docker de TensorFlow: ${message}`);
    }
  }

  /** Corre un comando y streamea su output por el gateway bajo un runId, esperando a que termine. */
  private execAndStream(runId: string, cmd: string, args: string[], cwd: string, extraEnv?: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { cwd, env: { ...process.env, PYTHONUNBUFFERED: '1', ...extraEnv } });
      child.stdout.on('data', (d) => this.gateway.emitLog(runId, 'stdout', d.toString()));
      child.stderr.on('data', (d) => this.gateway.emitLog(runId, 'stderr', d.toString()));
      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`"${cmd} ${args.join(' ')}" terminó con código ${code}`));
      });
    });
  }

  // ── Construcción de argv a partir de la definición + valores del form ──

  private buildArgv(script: ScriptDef, values: Record<string, unknown>): string[] {
    const argv: string[] = [];
    const positionals: ArgDef[] = [];
    const flags: ArgDef[] = [];
    for (const def of script.args) (def.flag ? flags : positionals).push(def);

    for (const def of flags) {
      const raw = values[def.name];
      if (def.kind === 'boolean') {
        if (raw === true) argv.push(def.flag as string);
        continue;
      }
      if (raw === undefined || raw === null || raw === '') {
        if (def.required) throw new BadRequestException(`Falta el argumento requerido "${def.name}"`);
        continue;
      }
      argv.push(def.flag as string, String(raw));
    }

    for (const def of positionals) {
      const raw = values[def.name];
      if (def.kind === 'files') {
        const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
        for (const item of list) argv.push(String(item));
        continue;
      }
      if (raw === undefined || raw === null || raw === '') {
        if (def.required) throw new BadRequestException(`Falta el argumento requerido "${def.name}"`);
        continue;
      }
      argv.push(String(raw));
    }

    return argv;
  }

  // ── Ejecutar un script individual ──────────────────────────────────────

  async runScript(scriptId: string, values: Record<string, unknown>): Promise<{ runId: string; done: Promise<RunAllStepResult> }> {
    const script = findScript(scriptId);
    if (!script) throw new NotFoundException(`Script "${scriptId}" no existe`);

    const argv = this.buildArgv(script, values ?? {});
    const runId = randomUUID();
    const startedAt = Date.now();

    // Si gpu-detect.ts marcó que esta GPU AMD necesita el alias de gfx target
    // (variantes móviles de RDNA2 sin kernels ROCm precompilados), hace falta
    // en cada corrida, no solo al instalar — sin esto el proceso segfaultea
    // apenas toca la GPU. No-op si no aplica (CUDA, CPU, o AMD sin override).
    const gpu = await detectGpu();
    const gpuEnv = gpu.hsaOverrideGfxVersion ? { HSA_OVERRIDE_GFX_VERSION: gpu.hsaOverrideGfxVersion } : {};

    // La API key de Roboflow vive en la config local del runner (settings.ts),
    // nunca hardcodeada en un script — se inyecta como env var solo para el
    // script que efectivamente la necesita.
    const roboflowEnv =
      script.id === 'shared-download-roboflow' && readSettings().roboflowApiKey
        ? { ROBOFLOW_API_KEY: readSettings().roboflowApiKey as string }
        : {};

    // TensorFlow en modo Docker (ver docker/tf-rocm/, ROADMAP.md workstream D)
    // corre en un contenedor en vez del venv — mismo script, misma cwd
    // conceptual (todo el repo montado en /workspace), distinto intérprete.
    // Los scripts de export quedan afuera de esto siempre — ver usesDocker().
    const useDocker = await this.usesDocker(script);

    let cmd: string;
    let args: string[];
    let cwd: string;
    let commandPreview: string;

    if (useDocker) {
      if (!(await isTfDockerImageReady())) {
        throw new BadRequestException(
          'La imagen Docker de TensorFlow (ROCm) todavía no está preparada — andá a "Configuración inicial" y preparala primero.',
        );
      }
      const scriptRelPath = path.relative(REPO_ROOT, path.join(script.cwd, script.script));
      cmd = 'docker';
      args = buildTfDockerRunArgs(scriptRelPath, argv, gpu.hsaOverrideGfxVersion);
      cwd = REPO_ROOT;
      commandPreview = `docker ${args.join(' ')}`;
    } else {
      cmd = await this.resolvePython(script.env);
      args = ['-u', script.script, ...argv];
      cwd = script.cwd;
      commandPreview = `${path.basename(cmd)} ${script.script} ${argv.join(' ')}`;
    }

    this.runs.set(runId, { id: runId, scriptId, status: 'running', startedAt });
    this.gateway.emitStatus(runId, 'running');
    this.gateway.emitLog(runId, 'stdout', `$ ${commandPreview}\n`);

    // "-u" + PYTHONUNBUFFERED: sin esto Python bufferea stdout por bloque (no por línea)
    // al detectar que no está conectado a una terminal real, y el output no llega al
    // renderer hasta que el buffer se llena o el proceso termina. No aplica al proceso
    // "docker" en sí (no es Python), pero no molesta dejarlo en el entorno.
    const child: ChildProcessWithoutNullStreams = spawn(cmd, args, {
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', ...(useDocker ? {} : gpuEnv), ...roboflowEnv },
      // detached: true en POSIX pone al proceso como líder de un nuevo
      // grupo de procesos (setpgid), no lo desconecta del server — hace
      // falta para poder matar el árbol entero en stopRun() (ver ahí):
      // orquestadores como 04_evaluate.py (--model both) lanzan sus propios
      // subprocesos por framework vía subprocess.run(), heredando el mismo
      // stdout/stderr (no lo recapturan) — matar solo el proceso padre no
      // los toca, quedan corriendo sueltos y su output sigue llegando por
      // el mismo pipe (confirmado: "[detenido por el usuario]" seguido de
      // más líneas de progreso reales). No-op en Windows (taskkill /t ya
      // mata el árbol por su cuenta, no vía grupos de procesos POSIX).
      detached: process.platform !== 'win32',
    });

    this.children.set(runId, child);

    child.stdout.on('data', (d) => this.gateway.emitLog(runId, 'stdout', d.toString()));
    child.stderr.on('data', (d) => this.gateway.emitLog(runId, 'stderr', d.toString()));

    const liveFile = script.liveFile?.(values ?? {});
    if (liveFile) this.startLivePolling(runId, liveFile);

    const done = new Promise<RunAllStepResult>((resolve) => {
      const finish = (outcome: 'success' | 'error', exitCode: number | null) => {
        this.stopLivePolling(runId);
        this.children.delete(runId);
        const status: RunAllStepResult['status'] = this.stopRequested.delete(runId) ? 'stopped' : outcome;
        const record = this.runs.get(runId);
        if (record) {
          record.status = status;
          record.endedAt = Date.now();
          record.exitCode = exitCode;
        }
        this.gateway.emitStatus(runId, status, { exitCode });
        if (status === 'success' && script.resultFiles) {
          this.readResultFiles(script.resultFiles(values ?? {})).then((results) => {
            if (results.length) this.gateway.emitResult(runId, results);
          });
        }
        resolve({
          scriptId,
          label: script.label,
          runId,
          status,
          exitCode,
          durationMs: Date.now() - startedAt,
        });
      };

      child.on('error', (err) => {
        this.gateway.emitLog(runId, 'stderr', `\n[error al lanzar el proceso] ${err.message}\n`);
        finish('error', null);
      });
      child.on('close', (code) => finish(code === 0 ? 'success' : 'error', code));
    });

    return { runId, done };
  }

  // ── Terraform (pestaña "Deploy", ROADMAP.md workstream I) ──────────────

  getTerraformStatus(): Promise<TerraformEligibility> {
    return getTerraformEligibility();
  }

  /**
   * Corre `terraform <action>` streameado, mismo shape que runScript() pero
   * sin pasar por ScriptDef/argv (Terraform no es un ScriptDef) — se
   * registra igual en `this.runs`/`this.children` así stopRun()/
   * GET /runs/:runId/useRunLogs funcionan sin modificarlos. apply/destroy
   * son reales, facturables y hacia afuera — exigen `confirm:true` explícito
   * en el body además de credenciales configuradas; nunca se auto-corren.
   */
  async runTerraform(action: TerraformAction, confirm: boolean): Promise<{ runId: string }> {
    const settings = readSettings();
    if (!settings.awsCredentials) {
      throw new BadRequestException('No hay credenciales AWS configuradas — pegalas en la pestaña "Deploy" primero.');
    }
    if ((action === 'apply' || action === 'destroy') && !confirm) {
      throw new BadRequestException(`"${action}" crea/destruye infraestructura real y facturable — requiere confirmación explícita.`);
    }

    const runId = randomUUID();
    const startedAt = Date.now();
    const args = [action, '-no-color'];
    if (action === 'apply' || action === 'destroy') args.push('-auto-approve');

    this.runs.set(runId, { id: runId, scriptId: `terraform:${action}`, status: 'running', startedAt });
    this.gateway.emitStatus(runId, 'running');
    this.gateway.emitLog(runId, 'stdout', `$ terraform ${args.join(' ')}\n`);

    const child: ChildProcessWithoutNullStreams = spawn('terraform', args, {
      cwd: TERRAFORM_DIR,
      // buildAwsCliEnv(), no un buildTerraformEnv() TF_VAR_*-based separado
      // (existía, eliminado 19 ago) — ver el comentario junto a
      // buildAwsCliEnv() en terraform.ts para el porqué: ese doble camino
      // era justo lo que dejaba a `terraform` expuesto al footgun de
      // `*.tfvars` pisando silenciosamente las credenciales frescas de esta
      // misma pestaña.
      env: { ...pathEnvWithToolBin(), ...buildAwsCliEnv(settings.awsCredentials) },
      // Mismo motivo que runScript(): apply/destroy pueden colgarse, y
      // stopRun() necesita poder matar el árbol de procesos completo en
      // POSIX (ver ese comentario más abajo).
      detached: process.platform !== 'win32',
    });
    this.children.set(runId, child);

    child.stdout.on('data', (d) => this.gateway.emitLog(runId, 'stdout', d.toString()));
    child.stderr.on('data', (d) => this.gateway.emitLog(runId, 'stderr', d.toString()));

    const finish = (outcome: 'success' | 'error', exitCode: number | null) => {
      this.children.delete(runId);
      const status: RunRecord['status'] = this.stopRequested.delete(runId) ? 'stopped' : outcome;
      const record = this.runs.get(runId);
      if (record) {
        record.status = status;
        record.endedAt = Date.now();
        record.exitCode = exitCode;
      }
      this.gateway.emitStatus(runId, status, { exitCode });
    };
    child.on('error', (err) => {
      this.gateway.emitLog(runId, 'stderr', `\n[error al lanzar terraform] ${err.message}\n`);
      finish('error', null);
    });
    child.on('close', (code) => finish(code === 0 ? 'success' : 'error', code));

    return { runId };
  }

  /** `terraform output -json` parseado a un objeto plano {clave: valor} — null si no hay state todavía (nunca se corrió apply) o terraform no está instalado, nunca un error. No se streamea (una respuesta rápida, no vale la pena un log). */
  getTerraformOutputs(): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn('terraform', ['output', '-json'], { cwd: TERRAFORM_DIR, env: pathEnvWithToolBin() });
      } catch {
        resolve(null);
        return;
      }
      let stdout = '';
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.on('error', () => resolve(null));
      child.on('close', (code) => {
        if (code !== 0) return resolve(null);
        try {
          const raw = JSON.parse(stdout) as Record<string, { value: unknown }>;
          const flat: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(raw)) flat[k] = v.value;
          resolve(flat);
        } catch {
          resolve(null);
        }
      });
    });
  }

  /**
   * Corre `infra/terraform/scripts/deploy-backend.sh` streameado — el paso
   * que le faltaba a la pestaña "Deploy": hasta ahora, actualizar el
   * CÓDIGO del backend ya corriendo (no crear/destruir infra, eso ya lo
   * hacen apply/destroy arriba) solo era posible corriendo ese script a
   * mano por terminal. Agregado a pedido del usuario, mismo día que I19/I22
   * (ROADMAP.md) encontraron bugs reales en el backend que necesitaban
   * justamente esto para llegar a producción.
   *
   * El script mismo sube backend/ a S3, resuelve secrets desde Secrets
   * Manager, y hace `docker build`+`docker run` en la instancia real vía
   * SSM Run Command (sin SSH — ver el propio header del script para el
   * porqué). Necesita terraform (para leer outputs) + aws cli + python3 en
   * PATH. `buildAwsCliEnv()`: el script llama a `aws` directo (s3 cp,
   * secretsmanager, ssm send-command), no a `terraform apply` — mismo
   * `AWS_*` env shape que `runTerraform()` también usa ahora (ver
   * buildAwsCliEnv()'s propio comentario en terraform.ts).
   */
  async deployBackend(): Promise<{ runId: string }> {
    const settings = readSettings();
    if (!settings.awsCredentials) {
      throw new BadRequestException('No hay credenciales AWS configuradas — pegalas en la pestaña "Deploy" primero.');
    }

    const scriptPath = path.join(TERRAFORM_DIR, 'scripts', 'deploy-backend.sh');
    const runId = randomUUID();
    this.gateway.emitLog(runId, 'stdout', `$ bash ${scriptPath}\n`);

    const child: ChildProcessWithoutNullStreams = spawn('bash', [scriptPath], {
      cwd: TERRAFORM_DIR,
      env: { ...pathEnvWithToolBin(), ...buildAwsCliEnv(settings.awsCredentials) },
      // detached en POSIX: el script puede tardar varios minutos (docker
      // build remoto + polling) — mismo motivo/mecanismo que runTerraform()
      // para que stopRun() pueda matar el árbol de procesos completo.
      detached: process.platform !== 'win32',
    });
    this.trackStreamedProcess(runId, child, 'aws:deploy-backend', Date.now());

    return { runId };
  }

  /**
   * ROADMAP.md M1 — `aws s3 sync` de `trading-app-ionic/public/models/` (los
   * `.onnx` exportados + `stage3-tabular-scaler.json`, gitignored — ver ese
   * `.gitignore`, nunca se versionan porque son artefactos generados, no
   * fuente) hacia `s3://{deploy_artifacts_bucket}/models/`. El eslabón que
   * faltaba para que cualquier otra máquina (o, más adelante, un runner de
   * CI sin GPU/datos de entrenamiento — ver M2/M3) pueda armar el APK sin
   * tener que re-entrenar/re-exportar nada localmente: quien sea que corra
   * "Correr todo" acá y después este botón deja los últimos modelos en un
   * único lugar canónico, sin importar en qué PC se hayan generado.
   *
   * Mismo bucket que ya usa `deploy-backend.sh` (`deploy_artifacts`), prefijo
   * separado a propósito (`models/`, no `deploys/`) — ese bucket tiene una
   * lifecycle rule que borra objetos a los 7 días, ahora scopeada solo a
   * `deploys/` (ver s3.tf) para que esto no se autodestruya. `sync --delete`,
   * no `cp` uno por uno, para que un archivo que ya no se genera (p.ej. un
   * stage renombrado) también desaparezca del lado de S3 en vez de quedar
   * huérfano ahí para siempre — mismo motivo que deployBackend() reusa este
   * bucket en vez de crear uno nuevo, mismo shape (`buildAwsCliEnv` +
   * `pathEnvWithToolBin`) que ese método ya establece para hablarle a `aws`
   * directo con las credenciales AWS propias de esta máquina, no las de
   * Terraform.
   */
  async uploadModelsToS3(): Promise<{ runId: string }> {
    const settings = readSettings();
    if (!settings.awsCredentials) {
      throw new BadRequestException('No hay credenciales AWS configuradas — pegalas en la pestaña "Deploy" primero.');
    }

    const modelsDir = path.join(TRADING_APP_DIR, 'public', 'models');
    if (!fs.existsSync(modelsDir)) {
      throw new BadRequestException(`No existe ${modelsDir} todavía — corré la exportación ONNX primero ("Correr todo" en esta pestaña).`);
    }

    const outputs = await this.getTerraformOutputs();
    const bucket = outputs?.deploy_artifacts_bucket_name;
    const region = outputs?.aws_region;
    if (typeof bucket !== 'string' || typeof region !== 'string') {
      throw new BadRequestException('No hay outputs de Terraform todavía — corré "apply" en la pestaña Deploy primero.');
    }

    const dest = `s3://${bucket}/models/`;
    const runId = randomUUID();
    this.gateway.emitLog(runId, 'stdout', `$ aws s3 sync ${modelsDir} ${dest} --region ${region} --delete\n`);

    const child: ChildProcessWithoutNullStreams = spawn(
      'aws',
      ['s3', 'sync', modelsDir, dest, '--region', region, '--delete'],
      { cwd: TRADING_APP_DIR, env: { ...pathEnvWithToolBin(), ...buildAwsCliEnv(settings.awsCredentials) } },
    );
    this.trackStreamedProcess(runId, child, 'aws:upload-models', Date.now());

    return { runId };
  }

  /**
   * Instala `terraform`/`aws` automáticamente (tool-install.ts) — mismo
   * shape de streaming que runTerraform() (runId + this.runs/gateway), pero
   * sin proceso hijo único: es una secuencia de pasos (resolver
   * versión → descargar → descomprimir/instalar) narrada línea a línea por
   * el mismo runId/LogConsole. Nunca sudo — ver tool-install.ts para el
   * porqué de cada rama por SO.
   */
  async installTool(tool: ToolInstallTarget): Promise<{ runId: string }> {
    const runId = randomUUID();
    const startedAt = Date.now();
    this.runs.set(runId, { id: runId, scriptId: `tool-install:${tool}`, status: 'running', startedAt });
    this.gateway.emitStatus(runId, 'running');
    this.gateway.emitLog(runId, 'stdout', `$ instalar ${tool}\n`);

    const log = (message: string) => this.gateway.emitLog(runId, 'stdout', `${message}\n`);

    installToolBinary(tool, log)
      .then(() => {
        const record = this.runs.get(runId);
        if (record) {
          record.status = 'success';
          record.endedAt = Date.now();
        }
        this.gateway.emitStatus(runId, 'success');
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.gateway.emitLog(runId, 'stderr', `\nFalló: ${message}\n`);
        const record = this.runs.get(runId);
        if (record) {
          record.status = 'error';
          record.endedAt = Date.now();
        }
        this.gateway.emitStatus(runId, 'error');
      });

    return { runId };
  }

  // ── SSM (pestaña Deploy — conectarse a lo que terraform ya creó) ────────
  // Complementa runTerraform()/getTerraformOutputs(): esas crean/destruyen
  // infra, esto es solo para hablarle a instancias que ya existen. Ningún
  // security group tiene puertos administrativos abiertos (ver
  // infra/terraform/security_groups.tf) — todo pasa por SSM.

  /** Expone SSM_INSTANCES (ssm.ts) para que el renderer no duplique labels/puertos a mano — mismo motivo que GET /run-all-sequences expone RUN_ALL_SEQUENCES. */
  getSsmInstances(): typeof SSM_INSTANCES {
    return SSM_INSTANCES;
  }

  async getSsmStatus(): Promise<{ sessionManagerPluginInstalled: boolean }> {
    return { sessionManagerPluginInstalled: await isSessionManagerPluginInstalled() };
  }

  /**
   * PATH aumentado + credenciales AWS, para cualquier `aws ssm ...` que
   * lance este servicio — sin esto, `aws` no tiene forma de autenticarse
   * (confirmado en vivo: `NoCredentials` real al probar `runSsmCommand()`
   * sin esto, mismo error que tendría cualquier usuario real). `buildAwsCliEnv()`
   * — mismas variables `AWS_ACCESS_KEY_ID`/etc. que `runTerraform()` también
   * usa ahora (ver ese comentario en terraform.ts). Dos rutas de
   * credenciales del proyecto (ver terraform.ts), esto es la de "corre
   * localmente", no la del rol de la instancia.
   */
  private awsCliEnv(): NodeJS.ProcessEnv {
    const settings = readSettings();
    if (!settings.awsCredentials) {
      throw new BadRequestException('No hay credenciales AWS configuradas — pegalas en la pestaña "Deploy" primero.');
    }
    return { ...pathEnvWithToolBin(), ...buildAwsCliEnv(settings.awsCredentials) };
  }

  /**
   * `aws s3api head-object` — null si el objeto no existe todavía (primera
   * subida) o si el comando falla por cualquier otro motivo (nunca tira,
   * el llamador lo trata igual que "no existe" y sube igual). Usado por
   * importCatalog() para no volver a subir `cards.json` (59MB) si ya está
   * arriba y no cambió — a pedido del usuario, viéndolo re-subir de cero
   * en cada corrida.
   */
  private s3ObjectSize(bucket: string, key: string, region: string, env: NodeJS.ProcessEnv): Promise<number | null> {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn('aws', ['s3api', 'head-object', '--bucket', bucket, '--key', key, '--region', region, '--query', 'ContentLength', '--output', 'text'], { env });
      } catch {
        resolve(null);
        return;
      }
      let out = '';
      child.stdout.on('data', (d) => (out += d.toString()));
      child.on('error', () => resolve(null));
      child.on('close', (code) => {
        if (code !== 0) return resolve(null);
        const n = parseInt(out.trim(), 10);
        resolve(Number.isFinite(n) ? n : null);
      });
    });
  }

  private async resolveSsmInstanceId(
    key: SsmInstanceKey,
  ): Promise<{ def: (typeof SSM_INSTANCES)[number]; instanceId: string; region: string }> {
    const def = SSM_INSTANCES.find((i) => i.key === key);
    if (!def) throw new BadRequestException(`Instancia SSM desconocida: "${key}"`);
    const outputs = await this.getTerraformOutputs();
    const instanceId = outputs?.[def.outputKey];
    const region = outputs?.aws_region;
    if (!instanceId || typeof instanceId !== 'string' || !region || typeof region !== 'string') {
      throw new BadRequestException(`No hay un instance id para "${key}" todavía — ¿corriste "terraform apply"?`);
    }
    return { def, instanceId, region };
  }

  /** Abre una terminal nativa del SO con una sesión SSM interactiva ya armada — no pasa por this.runs/gateway, es un proceso completamente aparte (su propia ventana), no algo que la app siga rastreando. */
  async openSsmTerminal(key: SsmInstanceKey): Promise<void> {
    const { instanceId, region } = await this.resolveSsmInstanceId(key);
    await launchNativeTerminal(buildStartSessionArgs(instanceId, region), this.awsCliEnv());
  }

  /**
   * Túnel de puerto (MailHog/MinIO) vía SSM — a diferencia de openSsmTerminal
   * de arriba, esto SÍ se registra en this.runs/this.children (mismo
   * runId/LogConsole/botón "Detener" que terraform init/plan/...): es un
   * proceso de larga duración que hay que poder parar, no algo fire-and-forget.
   */
  async startSsmPortForward(key: SsmInstanceKey): Promise<{ runId: string }> {
    const { def, instanceId, region } = await this.resolveSsmInstanceId(key);
    if (!def.webPort) throw new BadRequestException(`"${key}" no tiene una UI web para tunelear.`);

    const runId = randomUUID();
    const args = buildPortForwardArgs(instanceId, def.webPort, region);
    this.gateway.emitLog(runId, 'stdout', `$ aws ${args.join(' ')}\n`);

    const child: ChildProcessWithoutNullStreams = spawn('aws', args, {
      env: this.awsCliEnv(),
      // detached en POSIX: mismo motivo que runTerraform()/runScript() — el
      // túnel corre indefinidamente hasta que el usuario le da "Detener",
      // stopRun() necesita poder matar el grupo de procesos entero.
      detached: process.platform !== 'win32',
    });
    this.trackStreamedProcess(runId, child, `ssm-port-forward:${key}`, Date.now());

    return { runId };
  }

  /** Wiring compartido de un proceso de larga duración en this.runs/this.children/gateway — mismo bloque que runTerraform() repetía inline; factorizado acá porque startSsmPortForward() es ya la tercera copia casi idéntica (instalTool() de arriba también lo hace a mano, pero con pasos async en vez de un único child_process). */
  private trackStreamedProcess(runId: string, child: ChildProcessWithoutNullStreams, scriptId: string, startedAt: number): void {
    this.runs.set(runId, { id: runId, scriptId, status: 'running', startedAt });
    this.children.set(runId, child);
    this.gateway.emitStatus(runId, 'running');
    child.stdout.on('data', (d) => this.gateway.emitLog(runId, 'stdout', d.toString()));
    child.stderr.on('data', (d) => this.gateway.emitLog(runId, 'stderr', d.toString()));

    const finish = (outcome: 'success' | 'error', exitCode: number | null) => {
      this.children.delete(runId);
      const status: RunRecord['status'] = this.stopRequested.delete(runId) ? 'stopped' : outcome;
      const record = this.runs.get(runId);
      if (record) {
        record.status = status;
        record.endedAt = Date.now();
        record.exitCode = exitCode;
      }
      this.gateway.emitStatus(runId, status, { exitCode });
    };
    child.on('error', (err) => {
      this.gateway.emitLog(runId, 'stderr', `\n[error al lanzar el proceso] ${err.message}\n`);
      finish('error', null);
    });
    child.on('close', (code) => finish(code === 0 ? 'success' : 'error', code));
  }

  // ── Android hand-off (pestaña Deploy — Outputs) ─────────────────────────
  // Automatiza lo que el README documentaba solo en texto: pegar backend_url
  // en dos archivos locales, y correr los 3 comandos para reconstruir el
  // APK. A pedido del usuario ("¿esto no se puede automatizar?").

  /** Rápido, no streameado — son un par de escrituras de archivo locales, no vale la pena un runId/LogConsole para esto. */
  async applyAndroidBackendUrl(): Promise<ApplyBackendUrlResult> {
    const outputs = await this.getTerraformOutputs();
    const backendUrl = outputs?.backend_url;
    const backendHost = outputs?.backend_public_ip;
    if (!backendUrl || typeof backendUrl !== 'string' || !backendHost || typeof backendHost !== 'string') {
      throw new BadRequestException('No hay backend_url/backend_public_ip todavía — ¿corriste "terraform apply"?');
    }
    return applyBackendUrl(backendUrl, backendHost);
  }

  /** `npm run setup:opencv` -> `npm run build` -> `npx cap sync android` -> `gradlew assembleDebug`, streameado. Mismo JDK portable que ROADMAP.md's E3d instaló para esta máquina si no hay JAVA_HOME ya seteado (android-deploy.ts::resolveAndroidJavaHome). */
  async rebuildApk(): Promise<{ runId: string }> {
    const runId = randomUUID();
    this.runs.set(runId, { id: runId, scriptId: 'android:rebuild-apk', status: 'running', startedAt: Date.now() });
    this.gateway.emitStatus(runId, 'running');

    (async () => {
      try {
        const javaHome = resolveAndroidJavaHome();
        const extraEnv = javaHome ? { JAVA_HOME: javaHome } : undefined;
        this.gateway.emitLog(runId, 'stdout', `JAVA_HOME: ${javaHome ?? '(no encontrado — se usa lo que haya en el PATH)'}\n`);

        // ROADMAP.md I15: public/opencv.js es un asset generado (gitignored,
        // igual que public/tesseract/'s E3c) — sin este paso, un checkout
        // limpio que nunca corrió "npm run setup:opencv" a mano se rompe en
        // tiempo de ejecución (404 en el <script> tag), no en build time,
        // así que es fácil no notarlo hasta probarlo en el teléfono. Idempotente
        // (solo copia un archivo), correrlo siempre acá es más seguro que
        // confiar en que alguien se acuerde de correrlo a mano una vez.
        this.gateway.emitLog(runId, 'stdout', '$ npm run setup:opencv\n');
        await this.execAndStream(runId, 'npm', ['run', 'setup:opencv'], TRADING_APP_DIR, extraEnv);

        this.gateway.emitLog(runId, 'stdout', '$ npm run build\n');
        await this.execAndStream(runId, 'npm', ['run', 'build'], TRADING_APP_DIR, extraEnv);

        this.gateway.emitLog(runId, 'stdout', '$ npx cap sync android\n');
        await this.execAndStream(runId, 'npx', ['cap', 'sync', 'android'], TRADING_APP_DIR, extraEnv);

        const androidDir = path.join(TRADING_APP_DIR, 'android');
        const gradlew = path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
        this.gateway.emitLog(runId, 'stdout', `$ ${gradlew} assembleDebug\n`);
        await this.execAndStream(runId, gradlew, ['assembleDebug'], androidDir, extraEnv);

        const record = this.runs.get(runId);
        if (record) {
          record.status = 'success';
          record.endedAt = Date.now();
        }
        this.gateway.emitStatus(runId, 'success');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.gateway.emitLog(runId, 'stderr', `\nFalló: ${message}\n`);
        const record = this.runs.get(runId);
        if (record) {
          record.status = 'error';
          record.endedAt = Date.now();
        }
        this.gateway.emitStatus(runId, 'error');
      }
    })();

    return { runId };
  }

  /** El import de catálogo de 58,679 cartas (F6) vía SSM Run Command en vez de a mano — mismo mecanismo que scripts/deploy-backend.sh, ahora varios `docker exec` en chunks (ROADMAP.md I39, ver el comentario junto a `IMPORT_CATALOG_CHUNK_SIZE`). */
  /**
   * Dos bugs reales encontrados en vivo, corriendo esto contra la instancia
   * real por primera vez, ninguno hipotético:
   *  1. `certamen_1/data/cards.json` (59MB) nunca llega a la instancia — el
   *     deploy solo empaqueta `backend/`. Se sube ahora al bucket
   *     deploy_artifacts (mismo bucket que ya usa deploy-backend.sh) y se
   *     copia adentro del contenedor con `docker cp` antes de correr el
   *     import — el contenedor no tiene `aws` cli instalado, por eso se baja
   *     en el HOST (que sí lo tiene) y se copia adentro, no se baja directo
   *     desde adentro del contenedor.
   *  2. `ts-node prisma/import-catalog.ts` solo, revienta con
   *     `ERR_UNKNOWN_FILE_EXTENSION` — el `"module": "nodenext"` de
   *     tsconfig.json hace que el loader ESM nativo de Node intente cargar
   *     el .ts directo, sin pasar por el hook de ts-node. Fix confirmado:
   *     `TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}'` fuerza a ts-node
   *     a compilar este archivo puntual como CommonJS, sin tocar
   *     tsconfig.json ni el resto de la app.
   */
  async importCatalog(): Promise<{ runId: string }> {
    const outputs = await this.getTerraformOutputs();
    const backendInstanceId = outputs?.backend_instance_id;
    const region = outputs?.aws_region;
    const artifactsBucket = outputs?.deploy_artifacts_bucket_name;
    if (
      !backendInstanceId ||
      typeof backendInstanceId !== 'string' ||
      !region ||
      typeof region !== 'string' ||
      !artifactsBucket ||
      typeof artifactsBucket !== 'string'
    ) {
      throw new BadRequestException('No hay backend_instance_id/aws_region/deploy_artifacts_bucket_name todavía — ¿corriste "terraform apply"?');
    }
    const cardsJsonPath = path.join(REPO_ROOT, 'Proyecto', 'certamen_1', 'data', 'cards.json');
    if (!fs.existsSync(cardsJsonPath)) {
      throw new BadRequestException(`No se encontró ${cardsJsonPath} en esta máquina — corré el scraper (Scraper tab) primero.`);
    }
    // Se resuelve ANTES de crear el runId — así falta de credenciales es un
    // 400 inmediato en la llamada HTTP, no un run que arranca y muere solo.
    const env = this.awsCliEnv();

    const runId = randomUUID();
    this.runs.set(runId, { id: runId, scriptId: 'ssm-run-command:import-catalog', status: 'running', startedAt: Date.now() });
    this.gateway.emitStatus(runId, 'running');
    const log = (msg: string) => this.gateway.emitLog(runId, 'stdout', `${msg}\n`);

    (async () => {
      try {
        const s3Key = 'import/cards.json';
        const localSize = fs.statSync(cardsJsonPath).size;
        const remoteSize = await this.s3ObjectSize(artifactsBucket, s3Key, region, env);
        if (remoteSize === localSize) {
          log(`s3://${artifactsBucket}/${s3Key} ya existe y pesa lo mismo que el local (${localSize} bytes) — no se vuelve a subir.`);
        } else {
          log(
            remoteSize === null
              ? `Subiendo ${cardsJsonPath} (${localSize} bytes) a s3://${artifactsBucket}/${s3Key} ...`
              : `s3://${artifactsBucket}/${s3Key} existe pero con otro tamaño (remoto ${remoteSize} vs. local ${localSize} bytes) — se re-sube.`,
          );
          await this.execAndStream(runId, 'aws', ['s3', 'cp', cardsJsonPath, `s3://${artifactsBucket}/${s3Key}`, '--region', region], REPO_ROOT, env as Record<string, string>);
        }

        // ROADMAP.md I39 — real bug found live: a single `ts-node` process
        // handling all 58,679 upserts genuinely ran the real deployed
        // instance (only ~2GB RAM) out of V8 heap around row 24,000
        // ("FATAL ERROR: Reached heap limit... JavaScript heap out of
        // memory", confirmed via `aws ssm get-command-invocation`, not
        // guessed). Fix: several separate `ts-node` invocations, each a
        // fresh process/fresh heap, covering a `--offset`/`--limit` slice
        // each (`import-catalog.ts`'s own new flags) — multiple `docker
        // exec` calls into the SAME running container share its
        // filesystem, so the file only needs downloading/copying ONCE.
        // IMPORT_CATALOG_CHUNK_SIZE * IMPORT_CATALOG_CHUNKS must comfortably
        // exceed the real card count (58,679 as of this writing) — bump
        // IMPORT_CATALOG_CHUNKS if the catalog grows past what this covers.
        const importChunkCommands = Array.from({ length: IMPORT_CATALOG_CHUNKS }, (_, i) => {
          const offset = i * IMPORT_CATALOG_CHUNK_SIZE;
          return `docker exec -e TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}' mtg-backend-app node_modules/.bin/ts-node -r dotenv/config prisma/import-catalog.ts --file /tmp/cards.json --offset ${offset} --limit ${IMPORT_CATALOG_CHUNK_SIZE}`;
        });
        await runSsmCommand(
          backendInstanceId,
          [
            `aws s3 cp "s3://${artifactsBucket}/${s3Key}" /tmp/cards.json --region ${region}`,
            'docker cp /tmp/cards.json mtg-backend-app:/tmp/cards.json',
            ...importChunkCommands,
            'rm -f /tmp/cards.json',
          ],
          region,
          env,
          log,
        );
        const record = this.runs.get(runId);
        if (record) {
          record.status = 'success';
          record.endedAt = Date.now();
        }
        this.gateway.emitStatus(runId, 'success');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.gateway.emitLog(runId, 'stderr', `\nFalló: ${message}\n`);
        const record = this.runs.get(runId);
        if (record) {
          record.status = 'error';
          record.endedAt = Date.now();
        }
        this.gateway.emitStatus(runId, 'error');
      }
    })();

    return { runId };
  }

  /**
   * `prisma/seed.ts` — las 2 cuentas de prueba para loguearse en el APK
   * (`test@example.com`/`buyer@example.com`, password "password123") + 6
   * cartas + una transacción de ejemplo. Mismo fix de
   * `TS_NODE_COMPILER_OPTIONS` que importCatalog() (mismo bug de
   * ts-node/nodenext, confirmado en vivo — no se invoca vía `npm run
   * db:seed`/`prisma db seed` a propósito, esos no dejan pasar el env var
   * al ts-node interno). No idempotente (seed.ts mismo lo dice: reinserta
   * cartas/transacción en cada corrida) — no se agrega a ningún "correr
   * todo", es un botón manual.
   */
  async seedDatabase(): Promise<{ runId: string }> {
    const outputs = await this.getTerraformOutputs();
    const backendInstanceId = outputs?.backend_instance_id;
    const region = outputs?.aws_region;
    if (!backendInstanceId || typeof backendInstanceId !== 'string' || !region || typeof region !== 'string') {
      throw new BadRequestException('No hay backend_instance_id/aws_region todavía — ¿corriste "terraform apply"?');
    }
    const env = this.awsCliEnv();

    const runId = randomUUID();
    this.runs.set(runId, { id: runId, scriptId: 'ssm-run-command:seed-database', status: 'running', startedAt: Date.now() });
    this.gateway.emitStatus(runId, 'running');

    (async () => {
      try {
        await runSsmCommand(
          backendInstanceId,
          [`docker exec -e TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}' mtg-backend-app node_modules/.bin/ts-node -r dotenv/config prisma/seed.ts`],
          region,
          env,
          (msg) => this.gateway.emitLog(runId, 'stdout', `${msg}\n`),
        );
        const record = this.runs.get(runId);
        if (record) {
          record.status = 'success';
          record.endedAt = Date.now();
        }
        this.gateway.emitStatus(runId, 'success');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.gateway.emitLog(runId, 'stderr', `\nFalló: ${message}\n`);
        const record = this.runs.get(runId);
        if (record) {
          record.status = 'error';
          record.endedAt = Date.now();
        }
        this.gateway.emitStatus(runId, 'error');
      }
    })();

    return { runId };
  }

  /**
   * Resuelve un segmento "latest" en una ruta cuando no es ni un symlink real
   * ni una carpeta. Varios scripts (04_evaluate.py, 08_optuna_binary_classifier.py)
   * crean output/.../latest como symlink a la carpeta con timestamp más reciente,
   * pero dentro de una carpeta sincronizada con OneDrive el symlink puede quedar
   * "aplanado" a un archivo de texto plano — y su contenido no es confiable:
   * a veces es el nombre relativo de la carpeta, a veces una ruta absoluta de
   * OTRA máquina (ver update_latest en pytorch/src/optuna_support.py, que usa
   * run_dir.resolve()). En vez de confiar en ese contenido, se ignora y se
   * busca directamente la subcarpeta con timestamp más reciente por nombre
   * (el formato YYYY-MM-DD_HHMMSS ordena cronológicamente como string).
   */
  private async resolveLatestPath(fullPath: string): Promise<string> {
    const parts = fullPath.split(path.sep);
    const idx = parts.indexOf('latest');
    if (idx === -1) return fullPath;

    const latestPath = parts.slice(0, idx + 1).join(path.sep);
    try {
      const stat = await fs.promises.stat(latestPath);
      if (stat.isDirectory()) return fullPath; // symlink/copia real: ya apunta bien
    } catch {
      // 'latest' no existe — se sigue igual al escaneo de abajo.
    }

    const parentDir = parts.slice(0, idx).join(path.sep);
    try {
      const entries = await fs.promises.readdir(parentDir, { withFileTypes: true });
      const timestamped = entries
        .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{6}$/.test(e.name))
        .map((e) => e.name)
        .sort();
      const newest = timestamped[timestamped.length - 1];
      if (newest) return [...parts.slice(0, idx), newest, ...parts.slice(idx + 1)].join(path.sep);
    } catch {
      // directorio padre inaccesible — no hay nada más que intentar.
    }
    return fullPath;
  }

  /**
   * Lee los JSON de resultado que un script escribió (además de imprimirlos
   * por consola). Si un archivo no existe (p.ej. shared-evaluate corrió solo
   * "pytorch" y no hay metrics_tf.json) simplemente se lo salta en vez de fallar.
   */
  private async readResultFiles(defs: ResultFileDef[]): Promise<{ kind: string; label: string; data: unknown }[]> {
    const results: { kind: string; label: string; data: unknown }[] = [];
    for (const def of defs) {
      try {
        const resolvedPath = await this.resolveLatestPath(def.path);
        const raw = await fs.promises.readFile(resolvedPath, 'utf-8');
        results.push({ kind: def.kind, label: def.label, data: JSON.parse(raw) });
      } catch {
        // no existe o no es JSON válido — se omite, no es un error de la corrida.
      }
    }
    return results;
  }

  // ── Datos en vivo mientras una corrida está "running" ──────────────────

  /**
   * Poll-ea `def.path` cada 1.5s mientras la corrida sigue viva y emite
   * 'live-stats' cada vez que el contenido cambia (comparado por texto crudo,
   * evita parsear JSON dos veces por tick). El archivo puede no existir todavía
   * (se crea recién tras la primera época) — se ignora hasta que aparezca.
   */
  private startLivePolling(runId: string, def: LiveFileDef): void {
    let lastRaw: string | null = null;
    const tick = async () => {
      try {
        const raw = await fs.promises.readFile(def.path, 'utf-8');
        if (raw === lastRaw) return;
        lastRaw = raw;
        this.gateway.emitLiveStats(runId, def.kind, JSON.parse(raw));
      } catch {
        // el archivo todavía no existe o no es JSON válido en este tick — se reintenta.
      }
    };
    this.livePollers.set(runId, setInterval(tick, 1500));
  }

  private stopLivePolling(runId: string): void {
    const timer = this.livePollers.get(runId);
    if (!timer) return;
    clearInterval(timer);
    this.livePollers.delete(runId);
  }

  // ── Detener una corrida ─────────────────────────────────────────────────

  /**
   * Mata el proceso (y su árbol de subprocesos, vía taskkill /t en Windows —
   * scripts como compare_scanners.py lanzan sus propios subprocesos por venv).
   * Cuando el proceso es el `docker run` de TensorFlow-en-Docker, esto mata
   * al CLI cliente, no al contenedor directamente — funciona porque Docker
   * reenvía SIGTERM al contenedor cuando el cliente en foreground lo recibe
   * (mismo comportamiento que Ctrl+C en una terminal), pero es best-effort:
   * si el cliente muere sin alcanzar a reenviar la señal, el contenedor
   * (`--rm`) puede quedar corriendo un ratito más hasta salir solo.
   */
  stopRun(runId: string): boolean {
    const child = this.children.get(runId);
    if (!child || child.pid === undefined) return false;

    this.stopRequested.add(runId);
    this.gateway.emitLog(runId, 'stderr', '\n[detenido por el usuario]\n');

    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']);
    } else {
      // PID negativo = matar el grupo de procesos entero, no solo el PID
      // (funciona porque se spawneó con detached:true — ver runScript()).
      // Sin esto, matar solo el proceso padre dejaba corriendo sueltos los
      // subprocesos que orquestadores como 04_evaluate.py (--model both)
      // lanzan por subprocess.run() — confirmado en vivo: el progreso real
      // seguía llegando después de "[detenido por el usuario]".
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM'); // grupo ya no existe (ej. el proceso ya había terminado) — fallback al PID solo
      }
    }
    return true;
  }

  // ── "Correr todo" para un framework ────────────────────────────────────

  /**
   * Corre una secuencia de scriptIds en orden, emitiendo 'run-all-step' antes
   * de cada uno y frenando en el primer error/cancelación. Compartido por
   * `runAll` (un framework) y `runEverything` (todo) para no duplicar la
   * lógica de streaming — lo único que cambia es qué secuencia arman y qué
   * `framework` va en los eventos (el frontend lo usa para filtrar).
   */
  private async runSequence(
    overallRunId: string,
    framework: string,
    sequence: { scriptId: string; overrides?: Record<string, unknown> }[],
    steps: RunAllStepResult[],
  ): Promise<boolean> {
    for (const { scriptId, overrides } of sequence) {
      const script = findScript(scriptId);
      const { runId, done } = await this.runScript(scriptId, overrides ?? {});
      // El frontend usa este evento para saber a qué runId suscribirse y
      // mostrar la consola en vivo del paso actual (si no, "Correr todo" no
      // tiene forma de saber qué corrida está en curso hasta el reporte final).
      this.gateway.emitRunAllStep({ overallRunId, framework, scriptId, label: script?.label ?? scriptId, runId });
      const result = await done;
      steps.push(result);
      if (result.status !== 'success') return false; // detener secuencia ante error o cancelación
    }
    return true;
  }

  /**
   * `framework: 'export'` no es un framework real — es el botón "Correr
   * todo" de la pestaña Exportar (ver ExportPanel.tsx), que corre
   * `RUN_ALL_EXPORT_SEQUENCE` (todas las etapas ya entrenadas, ambos
   * frameworks) en vez de `RUN_ALL_SEQUENCES[framework]`. Mismo mecanismo
   * de streaming/eventos que pytorch/tensorflow — `runSequence()` y el
   * frontend (`useRunAllStatus`) ya agrupan por `scriptId`, no por este tag,
   * así que no hace falta un método aparte.
   */
  async runAll(framework: 'pytorch' | 'tensorflow' | 'export'): Promise<{ overallRunId: string; steps: RunAllStepResult[]; ok: boolean }> {
    const sequence = framework === 'export' ? RUN_ALL_EXPORT_SEQUENCE : RUN_ALL_SEQUENCES[framework];
    if (!sequence) throw new BadRequestException(`Framework desconocido: ${framework}`);

    const overallRunId = `run-all:${framework}:${Date.now()}`;
    const steps: RunAllStepResult[] = [];

    const finishedCleanly = await this.runSequence(
      overallRunId,
      framework,
      sequence.map((scriptId) => ({ scriptId, overrides: scriptId === 'shared-evaluate' ? { model: framework } : {} })),
      steps,
    );

    const ok = finishedCleanly && steps.length === sequence.length;
    this.gateway.server?.emit('run-all-report', { overallRunId, framework, steps, ok });
    return { overallRunId, steps, ok };
  }

  getRunAllSequences() {
    return RUN_ALL_SEQUENCES;
  }

  /**
   * "Correr todo" de una subpestaña de stage (FrameworkTab.tsx) — mismo
   * `runSequence()` de siempre, pero con una lista de scriptIds arbitraria
   * en vez de una `RUN_ALL_SEQUENCES[framework]` con nombre fijo. `label` es
   * el tag libre que identifica este botón en los eventos (no un framework
   * real) — quien llama es responsable de que los scriptIds sean seguros de
   * auto-correr (el renderer los arma cruzando contra RUN_ALL_SEQUENCES, ver
   * getRunAllSequences()), acá no se vuelve a filtrar por diseño: este
   * endpoint es genérico, no sabe qué es "seguro" para cada caso de uso.
   */
  async runCustomSequence(label: string, scriptIds: string[]): Promise<{ overallRunId: string; steps: RunAllStepResult[]; ok: boolean }> {
    const overallRunId = `run-all:${label}:${Date.now()}`;
    const steps: RunAllStepResult[] = [];

    const finishedCleanly = await this.runSequence(
      overallRunId,
      label,
      scriptIds.map((scriptId) => ({ scriptId })),
      steps,
    );

    const ok = finishedCleanly && steps.length === scriptIds.length;
    this.gateway.server?.emit('run-all-report', { overallRunId, framework: label, steps, ok });
    return { overallRunId, steps, ok };
  }

  // ── "Correr TODO" (dataset → ambos frameworks → export) ─────────────────

  /**
   * Botón "Do all", en 4 fases (una por pestaña, en el orden en que aparecen
   * en la UI): Scraper (solo `shared-downloader`, idempotente — ver
   * `RUN_ALL_DOWNLOAD_SEQUENCE`, NO incluye el scraper de catálogo en sí a
   * propósito) →
   * PyTorch completo → TensorFlow completo → Exportar (ONNX, todas las
   * etapas ya entrenadas, ambos frameworks). Mismo criterio "para en el
   * primer error" que `runAll`, ahora entre fases también.
   */
  async runEverything(): Promise<{ overallRunId: string; steps: RunAllStepResult[]; ok: boolean }> {
    const overallRunId = `run-all:everything:${Date.now()}`;
    const steps: RunAllStepResult[] = [];
    const totalScripts =
      RUN_ALL_DOWNLOAD_SEQUENCE.length +
      RUN_ALL_SEQUENCES.pytorch.length +
      RUN_ALL_SEQUENCES.tensorflow.length +
      RUN_ALL_EXPORT_SEQUENCE.length;

    let ok = await this.runSequence(
      overallRunId,
      'everything',
      RUN_ALL_DOWNLOAD_SEQUENCE.map((scriptId) => ({ scriptId })),
      steps,
    );

    if (ok) {
      for (const framework of ['pytorch', 'tensorflow'] as const) {
        ok = await this.runSequence(
          overallRunId,
          'everything',
          RUN_ALL_SEQUENCES[framework].map((scriptId) => ({
            scriptId,
            overrides: scriptId === 'shared-evaluate' ? { model: framework } : {},
          })),
          steps,
        );
        if (!ok) break;
      }
    }

    if (ok) {
      ok = await this.runSequence(
        overallRunId,
        'everything',
        RUN_ALL_EXPORT_SEQUENCE.map((scriptId) => ({ scriptId })),
        steps,
      );
    }

    ok = ok && steps.length === totalScripts;
    this.gateway.server?.emit('run-all-report', { overallRunId, framework: 'everything', steps, ok });
    return { overallRunId, steps, ok };
  }
}
