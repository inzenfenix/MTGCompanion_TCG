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
import { readSettings, writeSettings, RunnerSettings } from './settings';
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

  /**
   * Python a usar para CREAR el venv de un env (no para correrlo después —
   * una vez creado, siempre se usa el intérprete de adentro del venv). Prueba
   * env.preferredPythonBins en orden (ver el comentario en scripts.config.ts)
   * y cae al python genérico del sistema si ninguno está instalado.
   */
  private async resolveCreationPython(env: EnvDef): Promise<string> {
    for (const candidate of env.preferredPythonBins ?? []) {
      if (await this.probeCommand(candidate)) return candidate;
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

      const creationPython = await this.resolveCreationPython(env);
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
  private execAndStream(runId: string, cmd: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { cwd, env: { ...process.env, PYTHONUNBUFFERED: '1' } });
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
