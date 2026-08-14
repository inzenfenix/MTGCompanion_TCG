import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, getSocket, LiveStatsEvent, LogEvent, ResultEvent, StatusEvent } from './api';
import type { RunStatus } from './types';

// Cada cuánto se reconcilia contra GET /runs/:runId mientras el status local
// diga "running" — red de seguridad para cuando se pierde el evento de
// WebSocket que marca el final real (un reconnect en mal momento, o un
// restart del server en dev-watch-mode, que además borra el tracking
// en memoria del lado server) y el status local queda pegado en "running"
// para siempre aunque el proceso ya haya terminado. Sin esto, "Detener"
// sobre un run que el server ya daba por muerto no hacía nada visible
// (la respuesta era {ok:false} y acá no se hacía nada con eso).
const RECONCILE_INTERVAL_MS = 8000;

// Cuántas fallas de red SEGUIDAS (no 404 — esas se tratan aparte, ver abajo)
// se toleran antes de rendirse. Cubre un blip transitorio real (un solo
// request perdido) sin convertirse en un loop infinito si el server
// simplemente ya no está — algo que 3 intentos ya alcanza a diferenciar.
const MAX_CONSECUTIVE_FAILURES = 3;

export function useRunLogs(runId: string | null) {
  const [lines, setLines] = useState<string[]>([]);
  const [currentLine, setCurrentLine] = useState('');
  const [status, setStatus] = useState<RunStatus>('idle');
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [lastActivityAt, setLastActivityAt] = useState<number | null>(null);
  const [results, setResults] = useState<ResultEvent['results']>([]);
  const [liveStats, setLiveStats] = useState<LiveStatsEvent | null>(null);
  // true cuando el estado "error" viene de perder el rastro del run (404 de
  // GET /runs/:runId, o el server dejó de responder del todo) en vez de un
  // exit code real del proceso — ScriptCard lo usa para no decir "salió con
  // error" sobre algo que en realidad solo perdimos de vista.
  const [trackingLost, setTrackingLost] = useState(false);
  const currentLineRef = useRef('');
  // Espejo de `status` en un ref: el intervalo de reconciliación necesita
  // leer el valor MÁS RECIENTE sin que su propio efecto tenga que
  // re-suscribirse (y perder el socket) cada vez que status cambia.
  const statusRef = useRef<RunStatus>('idle');
  // Fallas de red seguidas del polling (no 404s — esas son terminales de
  // una, ver reconcileError abajo).
  const consecutiveFailuresRef = useRef(0);

  const applyStatus = useCallback((next: RunStatus, exit?: number | null) => {
    statusRef.current = next;
    setStatus(next);
    if (exit !== undefined) setExitCode(exit ?? null);
    if (next !== 'running' && currentLineRef.current) {
      setLines((prev) => [...prev, currentLineRef.current]);
      currentLineRef.current = '';
      setCurrentLine('');
    }
  }, []);

  // Un runId que responde 404 significa que el server está vivo y
  // contestando, pero genuinamente ya no tiene registro de este run (lo más
  // común: se reinició en dev-watch-mode y perdió el Map en memoria) — es un
  // hecho terminal, no algo que valga la pena reintentar. Cualquier otra
  // falla (fetch ni siquiera pudo conectar, etc.) sí puede ser un blip.
  const reconcileError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 404) {
        consecutiveFailuresRef.current = 0;
        setTrackingLost(true);
        applyStatus('error', null);
        return;
      }
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
        consecutiveFailuresRef.current = 0;
        setTrackingLost(true);
        applyStatus('error', null);
      }
      // si no, se asume transitorio y se reintenta en el próximo tick / la próxima llamada
    },
    [applyStatus],
  );

  /**
   * Reconciliación inmediata bajo demanda — la usa el botón "Detener" en
   * ScriptCard cuando POST /runs/:runId/stop devuelve {ok:false} (no había
   * nada que matar del lado server): en vez de quedarse callado, refleja
   * de una el estado real en vez de esperar hasta el próximo tick del
   * intervalo de abajo.
   */
  const refresh = useCallback(async () => {
    if (!runId) return;
    try {
      const record = await api.getRun(runId);
      consecutiveFailuresRef.current = 0;
      applyStatus(record.status, record.exitCode ?? null);
    } catch (e) {
      reconcileError(e);
    }
  }, [runId, applyStatus, reconcileError]);

  useEffect(() => {
    setLines([]);
    setCurrentLine('');
    currentLineRef.current = '';
    statusRef.current = runId ? 'running' : 'idle';
    setStatus(statusRef.current);
    setExitCode(null);
    setLastActivityAt(runId ? Date.now() : null);
    setResults([]);
    setLiveStats(null);
    setTrackingLost(false);
    consecutiveFailuresRef.current = 0;
    if (!runId) return;

    const socket = getSocket();

    const onLog = (evt: LogEvent) => {
      if (evt.runId !== runId) return;
      setLastActivityAt(Date.now());

      // Terminales de verdad tratan "\n" como confirmar la línea actual y "\r" como
      // volver al inicio de la línea (así se ven las barras de progreso tipo tqdm).
      // Si solo cortamos por "\n" acá, una barra de progreso queda invisible hasta
      // que termina, porque nunca emite "\n" mientras avanza.
      const committed: string[] = [];
      for (const ch of evt.data) {
        if (ch === '\n') {
          committed.push(currentLineRef.current);
          currentLineRef.current = '';
        } else if (ch === '\r') {
          currentLineRef.current = '';
        } else {
          currentLineRef.current += ch;
        }
      }
      if (committed.length) setLines((prev) => [...prev, ...committed]);
      setCurrentLine(currentLineRef.current);
    };

    const onStatus = (evt: StatusEvent) => {
      if (evt.runId !== runId) return;
      applyStatus(evt.status, evt.exitCode);
    };

    const onResult = (evt: ResultEvent) => {
      if (evt.runId !== runId) return;
      setResults(evt.results);
    };

    const onLiveStats = (evt: LiveStatsEvent) => {
      if (evt.runId !== runId) return;
      setLiveStats(evt);
    };

    socket.on('log', onLog);
    socket.on('status', onStatus);
    socket.on('result', onResult);
    socket.on('live-stats', onLiveStats);

    const interval = setInterval(() => {
      if (statusRef.current !== 'running') return;
      api
        .getRun(runId)
        .then((record) => {
          consecutiveFailuresRef.current = 0;
          if (record.status !== 'running') applyStatus(record.status, record.exitCode ?? null);
        })
        .catch(reconcileError);
    }, RECONCILE_INTERVAL_MS);

    return () => {
      socket.off('log', onLog);
      socket.off('status', onStatus);
      socket.off('result', onResult);
      socket.off('live-stats', onLiveStats);
      clearInterval(interval);
    };
  }, [runId, applyStatus, reconcileError]);

  return { lines, currentLine, status, exitCode, lastActivityAt, results, liveStats, trackingLost, refresh };
}
