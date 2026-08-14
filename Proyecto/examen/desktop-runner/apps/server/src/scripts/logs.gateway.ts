import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

/**
 * Gateway de solo-emisión: el server empuja líneas de log y cambios de estado
 * de cada corrida (runId) a todos los clientes conectados. El renderer filtra
 * por runId en el cliente.
 */
@WebSocketGateway({ cors: { origin: '*' } })
export class LogsGateway {
  @WebSocketServer()
  server: Server;

  emitLog(runId: string, stream: 'stdout' | 'stderr', data: string) {
    this.server?.emit('log', { runId, stream, data });
  }

  emitStatus(runId: string, status: 'running' | 'success' | 'error' | 'stopped', extra?: Record<string, unknown>) {
    this.server?.emit('status', { runId, status, ...extra });
  }

  emitVenvProgress(envId: string, message: string) {
    this.server?.emit('venv-progress', { envId, message });
  }

  emitRunAllStep(payload: { overallRunId: string; framework: string; scriptId: string; label: string; runId: string }) {
    this.server?.emit('run-all-step', payload);
  }

  emitResult(runId: string, results: { kind: string; label: string; data: unknown }[]) {
    this.server?.emit('result', { runId, results });
  }

  emitLiveStats(runId: string, kind: string, data: unknown) {
    this.server?.emit('live-stats', { runId, kind, data });
  }
}
