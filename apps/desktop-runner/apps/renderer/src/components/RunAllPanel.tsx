import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getSocket, api, RunAllReportEvent, RunAllStepStartedEvent } from '@/lib/api';
import type { RunAllStepResult } from '@/lib/types';

/**
 * Botón "Correr todo" genérico — un framework completo (`onStart` llama
 * `api.runAll(framework)`), la pestaña Exportar (`api.runAll('export')`), o
 * una subpestaña de stage puntual (`api.runSequence(label, scriptIds)`, ver
 * FrameworkTab.tsx) — a este componente no le importa cuál, solo necesita
 * `label` (el tag que el server manda de vuelta en los eventos, para saber
 * si son de ESTE botón) y `onStart` (qué endpoint dispara). Mismo criterio
 * que RunEverythingPanel: solo el botón, sin log en vivo acá (eso vive en
 * la subpestaña de stage que está corriendo — ver ScriptCard y
 * useRunAllStatus.ts).
 */
export function RunAllPanel({ label, onStart }: { label: string; onStart: () => Promise<unknown> }) {
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<RunAllStepResult[]>([]);
  const [ok, setOk] = useState<boolean | null>(null);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    const socket = getSocket();

    const onStepStarted = (evt: RunAllStepStartedEvent) => {
      if (evt.framework !== label) return;
      setCurrentRunId(evt.runId);
    };

    const onReport = (evt: RunAllReportEvent) => {
      if (evt.framework !== label) return;
      setSteps(evt.steps);
      setOk(evt.ok);
      setRunning(false);
      setCurrentRunId(null);
    };

    socket.on('run-all-step', onStepStarted);
    socket.on('run-all-report', onReport);
    return () => {
      socket.off('run-all-step', onStepStarted);
      socket.off('run-all-report', onReport);
    };
  }, [label]);

  const start = async () => {
    setRunning(true);
    setSteps([]);
    setOk(null);
    setCurrentRunId(null);
    await onStart();
  };

  const handleStop = async () => {
    if (!currentRunId) return;
    setStopping(true);
    try {
      await api.stop(currentRunId);
    } finally {
      setStopping(false);
    }
  };

  return (
    <Card className="border-dashed">
      <CardContent className="flex items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-2">
          <Button onClick={start} disabled={running}>
            {running ? 'Corriendo…' : 'Correr todo'}
          </Button>
          {running && currentRunId && (
            <Button variant="destructive" size="sm" onClick={handleStop} disabled={stopping}>
              {stopping ? 'Deteniendo…' : 'Detener'}
            </Button>
          )}
        </div>

        {steps.length > 0 && (
          <div className="flex flex-1 items-center justify-end gap-2 overflow-x-auto">
            {steps.map((s) => (
              <Badge key={s.runId} variant={s.status === 'success' ? 'success' : s.status === 'stopped' ? 'stopped' : 'error'}>
                {s.label}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>

      {ok !== null && (
        <CardContent className="pt-0">
          <p className={`text-sm font-medium ${ok ? 'text-success' : 'text-destructive'}`}>
            {ok ? 'Reporte final: todos los pasos OK.' : 'Reporte final: se detuvo por un error o cancelación — ver detalle en la subpestaña correspondiente.'}
          </p>
        </CardContent>
      )}
    </Card>
  );
}
