import { Body, Controller, Get, Param, Post, HttpCode } from '@nestjs/common';
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

  @Get('runs/:runId')
  getRun(@Param('runId') runId: string) {
    return this.scriptsService.getRun(runId);
  }

  @Post('envs/:envId/ensure')
  @HttpCode(202)
  async ensureVenv(@Param('envId') envId: 'pytorch' | 'tensorflow' | 'testing' | 'system') {
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
  async runAll(@Param('framework') framework: 'pytorch' | 'tensorflow') {
    // Se resuelve en background; el cliente escucha el evento 'run-all-report' por WebSocket
    // y puede seguir el progreso de cada paso por su runId individual (evento 'status'/'log').
    this.scriptsService.runAll(framework).catch(() => undefined);
    return { started: true, framework };
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
