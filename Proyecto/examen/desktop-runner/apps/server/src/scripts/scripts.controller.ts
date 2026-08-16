import { BadRequestException, Body, Controller, Get, Param, Post, HttpCode } from '@nestjs/common';
import { ScriptsService } from './scripts.service';

@Controller()
export class ScriptsController {
  constructor(private readonly scriptsService: ScriptsService) {}

  @Get('health')
  health() {
    return { ok: true };
  }

  @Get('scripts')
  listScripts() {
    return this.scriptsService.listScripts();
  }

  @Get('envs')
  listEnvs() {
    return this.scriptsService.listEnvs();
  }

  @Get('gpu')
  getGpuInfo() {
    return this.scriptsService.getGpuInfo();
  }

  // Elegibilidad + estado de la imagen del escape hatch Docker de TensorFlow
  // (ver docker/tf-rocm/, ROADMAP.md workstream D) — separado de /gpu porque
  // GpuInfo describe el hardware; esto describe si además se puede usarlo
  // vía Docker en esta máquina puntual (Linux + Docker instalado).
  @Get('tf-docker/status')
  getTfDockerStatus() {
    return this.scriptsService.getTfDockerStatus();
  }

  @Get('settings')
  getSettings() {
    return this.scriptsService.getSettings();
  }

  @Post('settings')
  updateSettings(@Body() body: Record<string, unknown>) {
    return this.scriptsService.updateSettings(body as any);
  }

  // Ruta estática, no ':id/card-count' — solo shared-scraper la necesita hoy
  // y así no hay que decidir qué pasa si se pide para un script sin sentido.
  @Get('scripts/shared-scraper/card-count')
  getScraperCardCount() {
    return this.scriptsService.getScraperCardCount();
  }

  @Get('export/comparison')
  getExportComparison() {
    return this.scriptsService.getExportComparison();
  }

  // Expone RUN_ALL_SEQUENCES (scripts.config.ts) para que el renderer pueda
  // armar botones "Correr todo" por subpestaña de stage (FrameworkTab.tsx)
  // sin duplicar la curación de "qué scripts son seguros de auto-correr" —
  // esa lista ya excluye Optuna/scanner/predict/etc. a propósito (CLAUDE.md
  // regla 7), un segundo mantenimiento manual del lado renderer se
  // desincroniza tarde o temprano.
  @Get('run-all-sequences')
  getRunAllSequences() {
    return this.scriptsService.getRunAllSequences();
  }

  // Pestaña "Deploy" (ROADMAP.md workstream I) — mismo mecanismo de
  // streaming que /scripts/:id/run (runId + eventos por WebSocket), pero
  // para `terraform <action>` en vez de un ScriptDef.
  @Get('terraform/status')
  getTerraformStatus() {
    return this.scriptsService.getTerraformStatus();
  }

  @Post('terraform/:action')
  @HttpCode(202)
  async runTerraform(
    @Param('action') action: 'init' | 'validate' | 'plan' | 'apply' | 'destroy',
    @Body() body: { confirm?: boolean },
  ) {
    if (!['init', 'validate', 'plan', 'apply', 'destroy'].includes(action)) {
      throw new BadRequestException(`Acción de terraform inválida: "${action}"`);
    }
    const { runId } = await this.scriptsService.runTerraform(action, body?.confirm === true);
    return { runId };
  }

  @Get('terraform/outputs')
  getTerraformOutputs() {
    return this.scriptsService.getTerraformOutputs();
  }

  // Instala terraform/aws cli automáticamente (tool-install.ts) — mismo
  // mecanismo de runId que arriba, no hace falta confirmación (nunca toca
  // sudo ni crea infraestructura, solo baja/copia binarios).
  @Post('terraform/install/:tool')
  @HttpCode(202)
  async installTool(@Param('tool') tool: 'terraform' | 'aws-cli' | 'session-manager-plugin') {
    if (!['terraform', 'aws-cli', 'session-manager-plugin'].includes(tool)) {
      throw new BadRequestException(`Herramienta desconocida: "${tool}"`);
    }
    const { runId } = await this.scriptsService.installTool(tool);
    return { runId };
  }

  // Acceso SSM a las instancias que terraform ya creó (no crea/destruye
  // nada — eso lo hacen las rutas terraform/* de arriba).
  @Get('ssm/instances')
  getSsmInstances() {
    return this.scriptsService.getSsmInstances();
  }

  @Get('ssm/status')
  getSsmStatus() {
    return this.scriptsService.getSsmStatus();
  }

  @Post('ssm/terminal/:instance')
  @HttpCode(202)
  async openSsmTerminal(@Param('instance') instance: 'backend' | 'postgres' | 'mailhog' | 'minio') {
    if (!['backend', 'postgres', 'mailhog', 'minio'].includes(instance)) {
      throw new BadRequestException(`Instancia desconocida: "${instance}"`);
    }
    await this.scriptsService.openSsmTerminal(instance);
    return { ok: true };
  }

  @Post('ssm/port-forward/:instance')
  @HttpCode(202)
  async startSsmPortForward(@Param('instance') instance: 'backend' | 'postgres' | 'mailhog' | 'minio') {
    if (!['backend', 'postgres', 'mailhog', 'minio'].includes(instance)) {
      throw new BadRequestException(`Instancia desconocida: "${instance}"`);
    }
    const { runId } = await this.scriptsService.startSsmPortForward(instance);
    return { runId };
  }

  // Automatiza el hand-off de Outputs → app (README's "After apply", ahora
  // botones en vez de copiar/pegar a mano).
  @Post('android/apply-backend-url')
  @HttpCode(200)
  applyAndroidBackendUrl() {
    return this.scriptsService.applyAndroidBackendUrl();
  }

  @Post('android/rebuild-apk')
  @HttpCode(202)
  async rebuildApk() {
    const { runId } = await this.scriptsService.rebuildApk();
    return { runId };
  }

  @Post('ssm/import-catalog')
  @HttpCode(202)
  async importCatalog() {
    const { runId } = await this.scriptsService.importCatalog();
    return { runId };
  }

  @Get('runs/:runId')
  getRun(@Param('runId') runId: string) {
    return this.scriptsService.getRun(runId);
  }

  @Post('envs/:envId/ensure')
  @HttpCode(202)
  async ensureVenv(@Param('envId') envId: 'pytorch' | 'tensorflow' | 'testing' | 'certamen2' | 'system' | 'tensorflow-docker') {
    await this.scriptsService.ensureVenv(envId);
    return { ok: true };
  }

  @Post('scripts/:id/run')
  @HttpCode(202)
  async runScript(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { runId } = await this.scriptsService.runScript(id, body ?? {});
    return { runId };
  }

  @Post('runs/:runId/stop')
  stopRun(@Param('runId') runId: string) {
    const ok = this.scriptsService.stopRun(runId);
    return { ok };
  }

  @Post('run-all/:framework')
  @HttpCode(202)
  async runAll(@Param('framework') framework: 'pytorch' | 'tensorflow' | 'export') {
    // Se resuelve en background; el cliente escucha el evento 'run-all-report' por WebSocket
    // y puede seguir el progreso de cada paso por su runId individual (evento 'status'/'log').
    // 'export' no es un framework real — corre RUN_ALL_EXPORT_SEQUENCE (botón "Correr todo"
    // de la pestaña Exportar, ver ExportPanel.tsx) — mismo mecanismo, distinta secuencia.
    this.scriptsService.runAll(framework).catch(() => undefined);
    return { started: true, framework };
  }

  // Genérico: corre una lista arbitraria de scriptIds en orden (botón "Correr
  // todo" de una subpestaña de stage, ver FrameworkTab.tsx) — mismo mecanismo
  // de streaming que run-all/:framework, pero sin una secuencia con nombre
  // fijo del lado server. `label` es solo el tag que se manda en los eventos
  // 'run-all-step'/'run-all-report' para que el frontend sepa cuál botón
  // actualizar (ver RunAllPanel.tsx) — no tiene que matchear ningún framework
  // real, es libre (ej. "pytorch:stage2").
  @Post('run-sequence')
  @HttpCode(202)
  async runSequence(@Body() body: { label: string; scriptIds: string[] }) {
    if (!body?.label || !Array.isArray(body.scriptIds) || body.scriptIds.length === 0) {
      throw new BadRequestException('Body inválido: se espera { label: string, scriptIds: string[] } no vacío.');
    }
    this.scriptsService.runCustomSequence(body.label, body.scriptIds).catch(() => undefined);
    return { started: true, label: body.label };
  }

  // Ruta separada de 'run-all/:framework' (no 'run-all/everything') a propósito:
  // ese :framework es un route param libre, así que 'everything' matchearía esa
  // misma ruta y terminaría en runAll('everything'), que no es un framework válido.
  @Post('run-everything')
  @HttpCode(202)
  async runEverything() {
    this.scriptsService.runEverything().catch(() => undefined);
    return { started: true };
  }
}
