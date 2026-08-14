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
  RUN_ALL_SEQUENCES,
  ScriptDef,
  SCRIPTS,
  findScript,
} from './scripts.config';
import { LogsGateway } from './logs.gateway';
import { detectGpu, GpuDetectionResult } from './gpu-detect';
import { getScraperCardCount, ScraperCardCountResult } from './scryfall-card-count';

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

  listScripts() {
    return SCRIPTS.map((s) => ({
      id: s.id,
      group: s.group,
      label: s.label,
      description: s.description,
      env: s.env,
      args: s.args,
      venvReady: this.venvReady(s.env),
    }));
  }

  listEnvs() {
    return Object.values(ENVS).map((e) => ({
      id: e.id,
      label: e.label,
      needsVenv: e.dir !== null,
      ready: this.venvReady(e.id),
    }));
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

  // ── Comparación PyTorch vs TensorFlow (pestaña "Export ONNX") ──────────

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

        const a = byFramework.pytorch.available ? (byFramework.pytorch.metrics?.[stageDef.metricKey] as number | undefined) : undefined;
        const b = byFramework.tensorflow.available ? (byFramework.tensorflow.metrics?.[stageDef.metricKey] as number | undefined) : undefined;

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
          pytorch: byFramework.pytorch,
          tensorflow: byFramework.tensorflow,
          recommendation,
        };
      }),
    );
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
  async ensureVenv(envId: EnvId): Promise<void> {
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

    const python = await this.resolvePython(script.env);
    const argv = this.buildArgv(script, values ?? {});
    const runId = randomUUID();
    const startedAt = Date.now();

    this.runs.set(runId, { id: runId, scriptId, status: 'running', startedAt });
    this.gateway.emitStatus(runId, 'running');
    this.gateway.emitLog(runId, 'stdout', `$ ${path.basename(python)} ${script.script} ${argv.join(' ')}\n`);

    // Si gpu-detect.ts marcó que esta GPU AMD necesita el alias de gfx target
    // (variantes móviles de RDNA2 sin kernels ROCm precompilados), hace falta
    // en cada corrida, no solo al instalar — sin esto el proceso segfaultea
    // apenas toca la GPU. No-op si no aplica (CUDA, CPU, o AMD sin override).
    const gpu = await detectGpu();
    const gpuEnv = gpu.hsaOverrideGfxVersion ? { HSA_OVERRIDE_GFX_VERSION: gpu.hsaOverrideGfxVersion } : {};

    // "-u" + PYTHONUNBUFFERED: sin esto Python bufferea stdout por bloque (no por línea)
    // al detectar que no está conectado a una terminal real, y el output no llega al
    // renderer hasta que el buffer se llena o el proceso termina.
    const child: ChildProcessWithoutNullStreams = spawn(python, ['-u', script.script, ...argv], {
      cwd: script.cwd,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', ...gpuEnv },
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
   */
  stopRun(runId: string): boolean {
    const child = this.children.get(runId);
    if (!child || child.pid === undefined) return false;

    this.stopRequested.add(runId);
    this.gateway.emitLog(runId, 'stderr', '\n[detenido por el usuario]\n');

    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']);
    } else {
      child.kill('SIGTERM');
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

  async runAll(framework: 'pytorch' | 'tensorflow'): Promise<{ overallRunId: string; steps: RunAllStepResult[]; ok: boolean }> {
    const sequence = RUN_ALL_SEQUENCES[framework];
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

  // ── "Correr TODO" (ambos frameworks + comparación final) ────────────────

  /**
   * Botón "Do all": PyTorch completo → TensorFlow completo → comparación de
   * ambos scanners sobre testing_photos/. Deliberadamente NO incluye
   * shared-scraper/shared-downloader (dataset compartido) — esos son un paso
   * de preparación que se corre una vez, no en cada corrida de entrenamiento
   * (re-descargar ~3.6 GB de imágenes cada vez que se aprieta "correr todo"
   * sería un desperdicio; quedan como botones propios en la pestaña "Dataset
   * compartido"). Mismo criterio "para en el primer error" que `runAll`.
   */
  async runEverything(): Promise<{ overallRunId: string; steps: RunAllStepResult[]; ok: boolean }> {
    const overallRunId = `run-all:everything:${Date.now()}`;
    const steps: RunAllStepResult[] = [];
    const totalScripts = RUN_ALL_SEQUENCES.pytorch.length + RUN_ALL_SEQUENCES.tensorflow.length + 1; // +1 = test-compare

    let ok = true;
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

    if (ok) {
      ok = await this.runSequence(overallRunId, 'everything', [{ scriptId: 'test-compare' }], steps);
    }

    ok = ok && steps.length === totalScripts;
    this.gateway.server?.emit('run-all-report', { overallRunId, framework: 'everything', steps, ok });
    return { overallRunId, steps, ok };
  }
}
