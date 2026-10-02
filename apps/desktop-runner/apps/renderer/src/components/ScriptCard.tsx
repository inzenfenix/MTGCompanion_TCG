import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { ArgForm } from './ArgForm';
import { LogConsole } from './LogConsole';
import { ResultsView } from './ResultsView';
import { LossCurveChart, type EpochPoint } from './charts/LossCurveChart';
import { useRunLogs } from '@/lib/useRunLogs';
import { api, getSocket, RunAllStepStartedEvent } from '@/lib/api';
import type { ScriptInfo } from '@/lib/types';

function defaultsFor(script: ScriptInfo, initialValues?: Record<string, unknown>) {
  const values: Record<string, unknown> = {};
  for (const arg of script.args) {
    if (arg.default !== undefined) values[arg.name] = arg.default;
  }
  return { ...values, ...initialValues };
}

export function ScriptCard({
  script,
  onVenvChanged,
  initialValues,
}: {
  script: ScriptInfo;
  onVenvChanged: () => void;
  /**
   * Sobreescribe el `default` de args puntuales para ESTE render — pensado
   * para scripts `group:'shared'` que aparecen en más de una pestaña con el
   * mismo ScriptDef (ej. shared-evaluate en pytorch Y tensorflow, ver
   * FrameworkTab.tsx): sin esto, el default fijo de `--model` ("both") corre
   * ambos frameworks aunque el usuario le dio "Correr" desde la pestaña de
   * uno solo — mismo criterio que ya usa runAll() del lado server para su
   * propia secuencia automática (override de `model` según el framework),
   * ahora también para el click manual de "Correr" de la tarjeta.
   */
  initialValues?: Record<string, unknown>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => defaultsFor(script, initialValues));
  const [runId, setRunId] = useState<string | null>(null);
  const [preparingVenv, setPreparingVenv] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const { lines, currentLine, status, exitCode, lastActivityAt, results, liveStats, trackingLost, refresh } = useRunLogs(runId);

  // Args con `linkedFrom` (ej. "delay" en shared-downloader) se recalculan
  // solos cuando cambia su arg fuente ("workers") — pero solo hasta que el
  // usuario edita ese campo a mano una vez, ahí queda desvinculado. No hace
  // falta re-render por esto (no afecta el JSX de por sí), así que es un
  // ref y no otro useState.
  const manuallyEditedRef = useRef<Set<string>>(new Set());

  // "Correr Todo"/"Correr todo" corre este mismo script server-side (ver
  // runSequence() en scripts.service.ts) sin pasar por handleRun() de acá
  // abajo — sin esto la tarjeta se quedaba muda durante una corrida
  // automática hasta que el usuario la abría y apretaba "Correr" de nuevo.
  // Adoptando el runId que llega por WebSocket, la consola/gráfico/badge
  // que ya existen se activan solos, en la pestaña donde el script vive de
  // verdad — así "Correr Todo" no necesita su propio panel de log.
  useEffect(() => {
    const socket = getSocket();
    const onStepStarted = (evt: RunAllStepStartedEvent) => {
      if (evt.scriptId !== script.id) return;
      setError(null);
      setRunId(evt.runId);
    };
    socket.on('run-all-step', onStepStarted);
    return () => {
      socket.off('run-all-step', onStepStarted);
    };
  }, [script.id]);

  const requiredMissing = useMemo(
    () => script.args.some((a) => a.required && !values[a.name] && !(Array.isArray(values[a.name]) && (values[a.name] as unknown[]).length)),
    [script.args, values],
  );

  const handleChange = (name: string, value: unknown) => {
    manuallyEditedRef.current.add(name);
    setValues((prev) => {
      const next = { ...prev, [name]: value };
      const numericValue = typeof value === 'number' ? value : Number(value);
      if (!Number.isNaN(numericValue)) {
        for (const linked of script.args) {
          if (linked.linkedFrom?.arg === name && !manuallyEditedRef.current.has(linked.name)) {
            next[linked.name] = Math.round(numericValue * linked.linkedFrom.factor * 1000) / 1000;
          }
        }
      }
      return next;
    });
  };

  const handleEnsureVenv = async () => {
    setPreparingVenv(true);
    setError(null);
    try {
      await api.ensureVenv(script.env);
      onVenvChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreparingVenv(false);
    }
  };

  const handleRun = async () => {
    setError(null);
    try {
      const { runId: id } = await api.run(script.id, values);
      setRunId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleStop = async () => {
    if (!runId) return;
    setStopping(true);
    try {
      const { ok } = await api.stop(runId);
      if (!ok) {
        // El server no encontró nada que matar — lo más probable es que el
        // proceso ya haya terminado (o el server se haya reiniciado en
        // dev-watch, perdiendo el tracking) y el evento de WebSocket que
        // avisaba eso nunca llegó, dejando el status local pegado en
        // "running" para siempre. Antes esto no hacía nada visible; ahora
        // se fuerza una reconciliación contra el estado real.
        await refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStopping(false);
    }
  };

  const badgeVariant =
    status === 'running' ? 'running' : status === 'success' ? 'success' : status === 'error' ? 'error' : status === 'stopped' ? 'stopped' : 'default';
  const statusLabel = status === 'idle' ? 'sin correr' : status === 'stopped' ? 'detenido' : status;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle>{script.label}</CardTitle>
          <Badge variant={badgeVariant as any}>{statusLabel}</Badge>
        </div>
        <CardDescription>{script.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {script.env !== 'system' && !script.venvReady && (
          <div className="flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <span>El venv de "{script.env}" todavía no existe.</span>
            <Button size="sm" variant="outline" disabled={preparingVenv} onClick={handleEnsureVenv}>
              {preparingVenv ? 'Instalando…' : 'Crear venv'}
            </Button>
          </div>
        )}

        <ArgForm args={script.args} values={values} onChange={handleChange} disabled={status === 'running'} />

        {error && <p className="text-xs text-destructive">{error}</p>}

        {status === 'running' && liveStats?.kind === 'training-history' && Array.isArray(liveStats.data) && liveStats.data.length > 0 && (
          <div className="space-y-1 rounded-lg border border-border bg-card p-3">
            <p className="text-xs font-medium text-muted-foreground">Loss en vivo — época {liveStats.data[liveStats.data.length - 1]?.epoch}</p>
            <LossCurveChart data={liveStats.data as EpochPoint[]} />
          </div>
        )}

        {results.length > 0 && <ResultsView results={results} />}

        {(status === 'error' || status === 'stopped') && (
          <Alert variant={status === 'error' ? 'destructive' : 'warning'}>
            <AlertTitle>{trackingLost ? 'Se perdió el rastro del proceso' : status === 'error' ? 'Terminó con error' : 'Detenido'}</AlertTitle>
            <AlertDescription>
              {trackingLost
                ? 'El server ya no tiene registro de este proceso (lo más probable: se reinició mientras corría, algo normal en modo dev). Puede que el proceso siga corriendo en segundo plano sin que la app lo sepa — revisa la consola de abajo por si alcanzó a dejar más output, y si quieres asegurarte de que terminó, dale "Reintentar".'
                : status === 'error'
                  ? `El script salió con error${exitCode != null ? ` (código ${exitCode})` : ''} — mira el detalle en la consola de abajo.`
                  : 'Se detuvo antes de terminar (manualmente, o porque el server ya no tenía el proceso — ver detalle en consola).'}
            </AlertDescription>
          </Alert>
        )}

        {runId && (
          <LogConsole lines={lines} currentLine={currentLine} status={status} lastActivityAt={lastActivityAt} />
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button onClick={handleRun} disabled={status === 'running' || requiredMissing}>
          {status === 'running' ? 'Corriendo…' : status === 'error' || status === 'stopped' ? 'Reintentar' : 'Correr'}
        </Button>
        {status === 'running' && (
          <Button variant="destructive" onClick={handleStop} disabled={stopping}>
            {stopping ? 'Deteniendo…' : 'Detener'}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
