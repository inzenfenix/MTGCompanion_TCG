import { useEffect, useRef, useState } from 'react';
import { getSocket, LiveStatsEvent, LogEvent, ResultEvent, StatusEvent } from './api';
import type { RunStatus } from './types';

export function useRunLogs(runId: string | null) {
  const [lines, setLines] = useState<string[]>([]);
  const [currentLine, setCurrentLine] = useState('');
  const [status, setStatus] = useState<RunStatus>('idle');
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [lastActivityAt, setLastActivityAt] = useState<number | null>(null);
  const [results, setResults] = useState<ResultEvent['results']>([]);
  const [liveStats, setLiveStats] = useState<LiveStatsEvent | null>(null);
  const currentLineRef = useRef('');

  useEffect(() => {
    setLines([]);
    setCurrentLine('');
    currentLineRef.current = '';
    setStatus(runId ? 'running' : 'idle');
    setExitCode(null);
    setLastActivityAt(runId ? Date.now() : null);
    setResults([]);
    setLiveStats(null);
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
      setStatus(evt.status);
      if (evt.exitCode !== undefined) setExitCode(evt.exitCode ?? null);
      if (evt.status !== 'running' && currentLineRef.current) {
        setLines((prev) => [...prev, currentLineRef.current]);
        currentLineRef.current = '';
        setCurrentLine('');
      }
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
    return () => {
      socket.off('log', onLog);
      socket.off('status', onStatus);
      socket.off('result', onResult);
      socket.off('live-stats', onLiveStats);
    };
  }, [runId]);

  return { lines, currentLine, status, exitCode, lastActivityAt, results, liveStats };
}
