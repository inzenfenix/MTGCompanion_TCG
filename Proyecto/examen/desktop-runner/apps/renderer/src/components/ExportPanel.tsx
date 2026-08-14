import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScriptCard } from './ScriptCard';
import { api } from '@/lib/api';
import type { ExportComparisonStage, ScriptInfo, StageFrameworkMetrics } from '@/lib/types';

const pct = (x: number | undefined | null) => (typeof x === 'number' ? `${(x * 100).toFixed(2)}%` : '—');

// Métricas secundarias por etapa, en el orden en que se muestran debajo del
// valor principal de la comparación (metricKey ya se ve arriba, no se repite acá).
const SECONDARY_METRICS: Record<string, { key: string; label: string }[]> = {
  stage1: [
    { key: 'precision', label: 'Precision' },
    { key: 'recall', label: 'Recall' },
    { key: 'f1', label: 'F1' },
    { key: 'roc_auc', label: 'ROC-AUC' },
  ],
  stage4: [
    { key: 'precision_macro', label: 'Precision (macro)' },
    { key: 'recall_macro', label: 'Recall (macro)' },
    { key: 'accuracy', label: 'Accuracy' },
  ],
};

function FrameworkColumn({
  label,
  data,
  metricKey,
  metricLabel,
  won,
}: {
  label: string;
  data: StageFrameworkMetrics;
  metricKey: string;
  metricLabel: string;
  won: boolean;
}) {
  if (!data.available) {
    return (
      <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">No entrenado todavía en esta máquina — corre la búsqueda de Optuna (08 · / 11 ·) con entrenamiento final para generar final_metrics.json.</p>
      </div>
    );
  }

  const secondary = SECONDARY_METRICS[metricKey === 'f1_macro' ? 'stage4' : 'stage1'];
  const m = data.metrics ?? {};

  return (
    <div className={`space-y-2 rounded-lg border p-3 ${won ? 'border-primary bg-primary/5' : 'border-border'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        {won && <Badge variant="success">Recomendado</Badge>}
      </div>
      <div>
        <p className="text-[11px] text-muted-foreground">{metricLabel}</p>
        <p className="text-2xl font-bold text-primary">{pct(m[metricKey] as number | undefined)}</p>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {secondary.map((s) => (
          <div key={s.key} className="flex items-center justify-between border-b border-border/50 py-0.5">
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-mono">{pct(m[s.key] as number | undefined)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StageSection({ stage, scripts, onVenvChanged }: { stage: ExportComparisonStage; scripts: ScriptInfo[]; onVenvChanged: () => void }) {
  const ptScript = scripts.find((s) => s.id === stage.pytorch.exportScriptId);
  const tfScript = scripts.find((s) => s.id === stage.tensorflow.exportScriptId);

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
            metricKey={stage.metricKey}
            metricLabel={stage.metricLabel}
            won={stage.recommendation === 'pytorch' || stage.recommendation === 'tie'}
          />
          <FrameworkColumn
            label="TensorFlow"
            data={stage.tensorflow}
            metricKey={stage.metricKey}
            metricLabel={stage.metricLabel}
            won={stage.recommendation === 'tensorflow' || stage.recommendation === 'tie'}
          />
        </div>

        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Exportar a ONNX</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {ptScript && <ScriptCard script={ptScript} onVenvChanged={onVenvChanged} />}
            {tfScript && <ScriptCard script={tfScript} onVenvChanged={onVenvChanged} />}
          </div>
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
