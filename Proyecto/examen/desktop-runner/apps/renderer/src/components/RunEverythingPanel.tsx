import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getSocket, api, RunAllReportEvent, RunAllStepStartedEvent } from '@/lib/api';
import type { RunAllStepResult } from '@/lib/types';

/**
 * Botón "Correr Todo" — corre las 4 fases del pipeline en el mismo orden en
 * que aparecen las pestañas: Scraper (solo la descarga de imágenes,
 * idempotente — no vuelve a scrapear el catálogo) → PyTorch completo →
 * TensorFlow completo → Exportar (ONNX, ambos frameworks). Es deliberadamente
 * solo un botón: el detalle en vivo
 * de cada paso (consola, gráfico de loss, resultados) ya no vive acá — se
 * ve directamente en la pestaña/subpestaña que está corriendo (ScriptCard
 * lo adopta solo, ver useEffect ahí) y el ícono de cada pestaña (ver
 * useRunAllStatus.ts) es lo que indica el progreso mientras tanto.
 */
export function RunEverythingPanel() {
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<RunAllStepResult[]>([]);
  const [ok, setOk] = useState<boolean | null>(null);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    const socket = getSocket();

    const onStepStarted = (evt: RunAllStepStartedEvent) => {
      if (evt.framework !== 'everything') return;
      setCurrentRunId(evt.runId);
    };

    const onReport = (evt: RunAllReportEvent) => {
      if (evt.framework !== 'everything') return;
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
  }, []);

  const start = async () => {
    setRunning(true);
    setSteps([]);
    setOk(null);
    setCurrentRunId(null);
    await api.runEverything();
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
    <Card className="border-2 border-primary/40 bg-primary/[0.03]">
      <CardContent className="flex items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-2">
          <Button onClick={start} disabled={running}>
            {running ? 'Corriendo…' : 'Correr Todo'}
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
            {ok ? `Reporte final: los ${steps.length} pasos OK.` : 'Reporte final: se detuvo por un error o cancelación — ver detalle en la pestaña correspondiente.'}
          </p>
        </CardContent>
      )}
    </Card>
  );
}
