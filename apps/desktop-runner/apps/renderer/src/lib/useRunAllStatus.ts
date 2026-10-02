import { useEffect, useMemo, useRef, useState } from 'react';
import { getSocket, RunAllReportEvent, RunAllStepStartedEvent } from './api';

export type TabStatus = 'missing' | 'running' | 'success' | 'error';

/**
 * Deriva un ícono de estado por "bucket" (pestaña, o subpestaña de stage)
 * a partir de los mismos eventos `run-all-step`/`run-all-report` que ya usan
 * RunEverythingPanel/RunAllPanel — un solo mecanismo sirve tanto para "Correr
 * TODO" (framework:'everything') como para "Correr todo" por framework,
 * porque agrupa por pertenencia de `scriptId` a un bucket, no por el tag
 * `framework` del evento (ver comentario de `runSequence()` en
 * scripts.service.ts: ambos emiten exactamente los mismos eventos).
 *
 * `buckets`: mapa `key -> scriptId[]` (ej. tabValue -> ids de esa pestaña).
 * Como la ejecución es siempre secuencial (runSequence corre un script a la
 * vez y solo avanza si el anterior salió 'success'), al ver arrancar un
 * script de OTRO bucket se puede asumir que todo bucket que estaba
 * "running" ya terminó bien — así los íconos se van poniendo en verde en
 * vivo, no solo al final.
 */
export function useRunAllStatus(buckets: Record<string, string[]>) {
  const [statusByKey, setStatusByKey] = useState<Record<string, TabStatus>>({});
  const [activeScriptId, setActiveScriptId] = useState<string | null>(null);
  const wasIdleRef = useRef(true);

  const bucketsKey = JSON.stringify(buckets);
  const scriptToKey = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [key, ids] of Object.entries(buckets)) {
      for (const id of ids) map[id] = key;
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucketsKey]);

  useEffect(() => {
    const socket = getSocket();

    const onStep = (evt: RunAllStepStartedEvent) => {
      const key = scriptToKey[evt.scriptId];
      const startingFresh = wasIdleRef.current;
      wasIdleRef.current = false;
      setActiveScriptId(evt.scriptId);
      setStatusByKey((prev) => {
        const next = startingFresh ? {} : { ...prev };
        for (const k of Object.keys(next)) {
          if (k !== key && next[k] === 'running') next[k] = 'success';
        }
        if (key) next[key] = 'running';
        return next;
      });
    };

    const onReport = (evt: RunAllReportEvent) => {
      wasIdleRef.current = true;
      setActiveScriptId(null);
      setStatusByKey((prev) => {
        const next = { ...prev };
        for (const step of evt.steps) {
          const key = scriptToKey[step.scriptId];
          if (!key) continue;
          next[key] = step.status === 'success' ? 'success' : 'error';
        }
        return next;
      });
    };

    socket.on('run-all-step', onStep);
    socket.on('run-all-report', onReport);
    return () => {
      socket.off('run-all-step', onStep);
      socket.off('run-all-report', onReport);
    };
  }, [scriptToKey]);

  return { statusByKey, activeScriptId };
}
