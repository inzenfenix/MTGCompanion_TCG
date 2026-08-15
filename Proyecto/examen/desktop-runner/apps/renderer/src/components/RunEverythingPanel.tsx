import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LogConsole } from './LogConsole';
import { ResultsView } from './ResultsView';
import { LossCurveChart, type EpochPoint } from './charts/LossCurveChart';
import { useRunLogs } from '@/lib/useRunLogs';
import { getSocket, api, RunAllReportEvent, RunAllStepStartedEvent } from '@/lib/api';
import type { RunAllStepResult } from '@/lib/types';

// Mismo total que arma scripts.service.ts#runEverything: 1 paso de descarga
// (shared-downloader) + 4 de PyTorch + 4 de TensorFlow + 4 de export ONNX.
// Si esa secuencia cambia, esto queda desactualizado como cosmético nomás
// (la barra de progreso), no rompe nada.
const TOTAL_STEPS = 13;

/**
 * Botón "Do all" — corre las 4 fases del pipeline en el mismo orden en que
 * aparecen las pestañas: Dataset compartido (solo la descarga, idempotente)
 * → PyTorch completo → TensorFlow completo → Exportar (ONNX, ambos
 * frameworks). Vive en App.tsx por fuera de las tabs (a diferencia de
 * RunAllPanel, que es por framework y vive dentro de la pestaña de cada uno)
 * porque conceptualmente no pertenece a ninguna pestaña en particular.
 */
export function RunEverythingPanel() {
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<RunAllStepResult[]>([]);
  const [ok, setOk] = useState<boolean | null>(null);
  const [currentStep, setCurrentStep] = useState<{ scriptId: string; label: string; runId: string } | null>(null);
  const [stopping, setStopping] = useState(false);
  const { lines, currentLine, status, lastActivityAt, results, liveStats } = useRunLogs(currentStep?.runId ?? null);

  useEffect(() => {
    const socket = getSocket();

    const onStepStarted = (evt: RunAllStepStartedEvent) => {
      if (evt.framework !== 'everything') return;
      setCurrentStep({ scriptId: evt.scriptId, label: evt.label, runId: evt.runId });
    };

    const onReport = (evt: RunAllReportEvent) => {
      if (evt.framework !== 'everything') return;
      setSteps(evt.steps);
      setOk(evt.ok);
      setRunning(false);
      setCurrentStep(null);
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
    setCurrentStep(null);
    await api.runEverything();
  };

  const handleStop = async () => {
    if (!currentStep) return;
    setStopping(true);
    try {
      await api.stop(currentStep.runId);
    } finally {
      setStopping(false);
    }
  };

  return (
    <Card className="border-2 border-primary/40 bg-primary/[0.03]">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Correr TODO</CardTitle>
            <CardDescription>
              Corre las 4 pestañas en orden: Dataset compartido (descarga de imágenes, idempotente — no
              vuelve a scrapear el catálogo) → PyTorch completo → TensorFlow completo → Exportar (ONNX,
              ambos frameworks). Se detiene en el primer error.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {running && currentStep && (
              <Button variant="destructive" size="sm" onClick={handleStop} disabled={stopping}>
                {stopping ? 'Deteniendo…' : 'Detener'}
              </Button>
            )}
            <Button onClick={start} disabled={running}>
              {running ? 'Corriendo…' : 'Correr todo (PyTorch + TensorFlow)'}
            </Button>
          </div>
        </div>
      </CardHeader>

      {currentStep && (
        <CardContent className="space-y-2">
          <p className="text-sm font-medium">
            Paso {steps.length + 1}/{TOTAL_STEPS}: {currentStep.label}
          </p>
          {status === 'running' && liveStats?.kind === 'training-history' && Array.isArray(liveStats.data) && liveStats.data.length > 0 && (
            <div className="space-y-1 rounded-lg border border-border bg-card p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Loss en vivo — época {liveStats.data[liveStats.data.length - 1]?.epoch}
              </p>
              <LossCurveChart data={liveStats.data as EpochPoint[]} />
            </div>
          )}
          {results.length > 0 && <ResultsView results={results} />}
          <LogConsole lines={lines} currentLine={currentLine} status={status} lastActivityAt={lastActivityAt} />
        </CardContent>
      )}

      {steps.length > 0 && (
        <CardContent className="space-y-2">
          {steps.map((s) => (
            <div key={s.runId} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span>{s.label}</span>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{(s.durationMs / 1000).toFixed(1)}s</span>
                <Badge variant={s.status === 'success' ? 'success' : s.status === 'stopped' ? 'stopped' : 'error'}>{s.status}</Badge>
              </div>
            </div>
          ))}
          {ok !== null && (
            <p className={`text-sm font-medium ${ok ? 'text-success' : 'text-destructive'}`}>
              {ok
                ? `Reporte final: los ${steps.length} pasos OK.`
                : 'Reporte final: se detuvo por un error o cancelación — ver detalle arriba.'}
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
