import { useEffect, useState } from 'react';
import { getSocket, StatusEvent, VenvProgressEvent } from './api';
import type { RunStatus } from './types';

/**
 * Progreso en vivo de `ensureVenv(envId)`: mensajes de texto (evento
 * 'venv-progress') + estado (evento 'status', bajo el runId sintético
 * "venv:<envId>" que usa ScriptsService.ensureVenv). Separado de useRunLogs
 * porque los mensajes de venv no son stdout/stderr de un script — son notas
 * explicativas (qué GPU se detectó, qué canal de pip se está probando, etc.).
 */
export function useVenvProgress(envId: string | null) {
  const [messages, setMessages] = useState<string[]>([]);
  const [status, setStatus] = useState<RunStatus>('idle');

  useEffect(() => {
    setMessages([]);
    setStatus('idle');
    if (!envId) return;

    const socket = getSocket();
    const runId = `venv:${envId}`;

    const onProgress = (evt: VenvProgressEvent) => {
      if (evt.envId !== envId) return;
      setMessages((prev) => [...prev, evt.message]);
    };

    const onStatus = (evt: StatusEvent) => {
      if (evt.runId !== runId) return;
      // 'running' marca el arranque de una corrida nueva (ej. el usuario le dio
      // "Preparar" de nuevo) — se limpian los mensajes de la corrida anterior.
      if (evt.status === 'running') setMessages([]);
      setStatus(evt.status);
    };

    socket.on('venv-progress', onProgress);
    socket.on('status', onStatus);
    return () => {
      socket.off('venv-progress', onProgress);
      socket.off('status', onStatus);
    };
  }, [envId]);

  return { messages, status };
}
