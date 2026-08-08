import { useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArgForm } from './ArgForm';
import { LogConsole } from './LogConsole';
import { ResultsView } from './ResultsView';
import { LossCurveChart, type EpochPoint } from './charts/LossCurveChart';
import { useRunLogs } from '@/lib/useRunLogs';
import { api } from '@/lib/api';
import type { ScriptInfo } from '@/lib/types';

function defaultsFor(script: ScriptInfo) {
  const values: Record<string, unknown> = {};
  for (const arg of script.args) {
    if (arg.default !== undefined) values[arg.name] = arg.default;
  }
  return values;
}

export function ScriptCard({ script, onVenvChanged }: { script: ScriptInfo; onVenvChanged: () => void }) {
  const [values, setValues] = useState<Record<string, unknown>>(() => defaultsFor(script));
  const [runId, setRunId] = useState<string | null>(null);
  const [preparingVenv, setPreparingVenv] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const { lines, currentLine, status, lastActivityAt, results, liveStats } = useRunLogs(runId);

  const requiredMissing = useMemo(
    () => script.args.some((a) => a.required && !values[a.name] && !(Array.isArray(values[a.name]) && (values[a.name] as unknown[]).length)),
    [script.args, values],
  );

  const handleChange = (name: string, value: unknown) => setValues((prev) => ({ ...prev, [name]: value }));

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
      await api.stop(runId);
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

        {runId && (
          <LogConsole lines={lines} currentLine={currentLine} status={status} lastActivityAt={lastActivityAt} />
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button onClick={handleRun} disabled={status === 'running' || requiredMissing}>
          {status === 'running' ? 'Corriendo…' : 'Correr'}
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
