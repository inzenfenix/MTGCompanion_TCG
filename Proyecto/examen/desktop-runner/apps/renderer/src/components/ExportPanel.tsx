import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScriptCard } from './ScriptCard';
import { RunAllPanel } from './RunAllPanel';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { getMetric, formatMetric, SECONDARY_METRICS } from '@/lib/exportMetrics';
import type { ExportComparisonStage, ScriptInfo, StageFrameworkMetrics } from '@/lib/types';

type Framework = 'pytorch' | 'tensorflow';

// La tarjeta de métricas de cada framework ES el selector — no hay un
// botón aparte arriba. Se clickea la tarjeta entera; "seleccionada" (anillo
// azul) y "recomendada" (badge verde) son estados independientes, porque el
// usuario puede elegir exportar el que no ganó la comparación.
function FrameworkColumn({
  label,
  data,
  stage,
  metricKey,
  metricLabel,
  format,
  won,
  selected,
  onSelect,
}: {
  label: string;
  data: StageFrameworkMetrics;
  stage: string;
  metricKey: string;
  metricLabel: string;
  format: 'percent' | 'decimal' | undefined;
  won: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  if (!data.available) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'w-full space-y-2 rounded-lg border border-dashed p-3 text-left transition-colors hover:border-primary/50',
          selected ? 'border-primary ring-2 ring-primary ring-offset-2 ring-offset-background' : 'border-border',
        )}
      >
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">No entrenado todavía en esta máquina — corre la búsqueda de Optuna de esta etapa con entrenamiento final para generar final_metrics.json.</p>
      </button>
    );
  }

  const secondary = SECONDARY_METRICS[stage] ?? [];
  const m = data.metrics ?? {};

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full space-y-2 rounded-lg border p-3 text-left transition-colors',
        won ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
        selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        {won && <Badge variant="success">Recomendado</Badge>}
      </div>
      <div>
        <p className="text-[11px] text-muted-foreground">{metricLabel}</p>
        <p className="text-2xl font-bold text-primary">{formatMetric(getMetric(m, metricKey), format)}</p>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {secondary.map((s) => (
          <div key={s.key} className="flex items-center justify-between border-b border-border/50 py-0.5">
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-mono">{formatMetric(getMetric(m, s.key), format)}</span>
          </div>
        ))}
      </div>
    </button>
  );
}

// Empate o sin datos todavía: no hay "el mejor" real que preseleccionar —
// PyTorch gana el desempate solo como default estable (mismo orden en que
// ya se listan las columnas), no como una recomendación real.
function defaultFramework(stage: ExportComparisonStage): Framework {
  return stage.recommendation === 'tensorflow' ? 'tensorflow' : 'pytorch';
}

function StageSection({ stage, scripts, onVenvChanged }: { stage: ExportComparisonStage; scripts: ScriptInfo[]; onVenvChanged: () => void }) {
  // Default = el framework que gana la comparación (o PyTorch en caso de
  // empate/sin datos) — el usuario puede clickear la otra tarjeta para
  // cambiarlo, pero arranca en "el mejor elegido": elegir framework primero
  // (clickeando su tarjeta), y que solo entonces aparezcan sus opciones de
  // exportar más abajo.
  const [selected, setSelected] = useState<Framework>(() => defaultFramework(stage));
  const script = scripts.find((s) => s.id === stage[selected].exportScriptId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{stage.label}</CardTitle>
        <CardDescription>
          {stage.recommendation === 'tie'
            ? `Empate práctico en ${stage.metricLabel} (diferencia < 0.5 puntos) — cualquiera de los dos sirve, exporta el que prefieras.`
            : stage.recommendation
              ? `${stage.recommendation === 'pytorch' ? 'PyTorch' : 'TensorFlow'} gana en ${stage.metricLabel}.`
              : 'Todavía no hay ningún modelo entrenado en esta máquina para comparar.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FrameworkColumn
            label="PyTorch"
            data={stage.pytorch}
            stage={stage.stage}
            metricKey={stage.metricKey}
            metricLabel={stage.metricLabel}
            format={stage.format}
            won={stage.recommendation === 'pytorch' || stage.recommendation === 'tie'}
            selected={selected === 'pytorch'}
            onSelect={() => setSelected('pytorch')}
          />
          <FrameworkColumn
            label="TensorFlow"
            data={stage.tensorflow}
            stage={stage.stage}
            metricKey={stage.metricKey}
            metricLabel={stage.metricLabel}
            format={stage.format}
            won={stage.recommendation === 'tensorflow' || stage.recommendation === 'tie'}
            selected={selected === 'tensorflow'}
            onSelect={() => setSelected('tensorflow')}
          />
        </div>

        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Exportar a ONNX</p>
          {script && <ScriptCard script={script} onVenvChanged={onVenvChanged} />}
        </div>
      </CardContent>
    </Card>
  );
}

export function ExportPanel({ scripts, onVenvChanged }: { scripts: ScriptInfo[]; onVenvChanged: () => void }) {
  const [stages, setStages] = useState<ExportComparisonStage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .exportComparison()
      .then(setStages)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Compara los resultados reales de la búsqueda de Optuna (PyTorch vs TensorFlow) por etapa dual-framework y
        exporta a ONNX el modelo que elijas — cada botón "Correr" de abajo dispara el mismo export script registrado
        en la pestaña de su framework (venv, logs en vivo y todo lo demás se comparten con el resto del runner).
      </p>

      <RunAllPanel label="export" onStart={() => api.runAll('export')} />

      {error && (
        <Alert variant="destructive">
          <AlertTitle>No se pudo cargar la comparación</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!stages && !error && <p className="text-sm text-muted-foreground">Cargando métricas…</p>}

      {stages?.map((stage) => (
        <StageSection key={stage.stage} stage={stage} scripts={scripts} onVenvChanged={onVenvChanged} />
      ))}
    </div>
  );
}
