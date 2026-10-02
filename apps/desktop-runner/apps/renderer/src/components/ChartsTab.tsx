import { useEffect, useState } from 'react';
import { Tabs } from '@/components/ui/tabs';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { FrameworkComparisonChart, type ComparisonBarDatum } from './charts/FrameworkComparisonChart';
import { LossCurveChart } from './charts/LossCurveChart';
import { RocCurveChart } from './charts/RocCurveChart';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { getMetric, formatMetric, SECONDARY_METRICS } from '@/lib/exportMetrics';
import type { ExportComparisonStage, StageExtras } from '@/lib/types';

type StageValue = 'stage1' | 'stage2' | 'stage3' | 'stage4';

const STAGES: { value: StageValue; label: string }[] = [
  { value: 'stage1', label: 'Stage 1 — Detector' },
  { value: 'stage2', label: 'Stage 2 — Validador de texto' },
  { value: 'stage3', label: 'Stage 3 — Precio' },
  { value: 'stage4', label: 'Stage 4 — Condición' },
];

/**
 * Métricas a graficar por etapa: metricKey (la principal) + secundarias —
 * pero solo cuando comparten escala 0..1 con la principal. Stage 3 es
 * 'decimal' (R² en log-espacio) y sus secundarias son MAE en USD/log-USD,
 * una escala totalmente distinta — mezclarlas en el mismo bar chart leería
 * mal (ver DecimalSecondaryStats más abajo, que las muestra aparte).
 */
function buildChartData(stage: ExportComparisonStage): ComparisonBarDatum[] {
  const metrics =
    stage.format === 'decimal'
      ? [{ key: stage.metricKey, label: stage.metricLabel }]
      : [{ key: stage.metricKey, label: stage.metricLabel }, ...(SECONDARY_METRICS[stage.stage] ?? [])];
  const pt = stage.pytorch.available ? stage.pytorch.metrics : undefined;
  const tf = stage.tensorflow.available ? stage.tensorflow.metrics : undefined;
  return metrics.map(({ key, label }) => ({
    metric: label,
    pytorch: pt ? getMetric(pt, key) : undefined,
    tensorflow: tf ? getMetric(tf, key) : undefined,
  }));
}

function DecimalSecondaryStats({ stage }: { stage: ExportComparisonStage }) {
  const secondary = SECONDARY_METRICS[stage.stage] ?? [];
  if (!secondary.length) return null;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {secondary.map((s) => (
        <div key={s.key} className="space-y-1 rounded-md border border-border/50 p-2 text-xs">
          <p className="text-muted-foreground">{s.label}</p>
          <div className="flex justify-between gap-2 font-mono">
            <span>PT: {formatMetric(stage.pytorch.available ? getMetric(stage.pytorch.metrics ?? {}, s.key) : undefined, stage.format)}</span>
            <span>TF: {formatMetric(stage.tensorflow.available ? getMetric(stage.tensorflow.metrics ?? {}, s.key) : undefined, stage.format)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function FrameworkColumnChart({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="text-center">
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/**
 * Pérdida por época + curva ROC, PyTorch al lado de TensorFlow — vienen de
 * `extras` (GET /charts/extras), NO de final_metrics.json (Optuna no
 * persiste ninguna de las dos, ver ROADMAP.md N1). Cada columna se omite
 * sola si ese framework no tiene el archivo en esta máquina, en vez de
 * mostrar un chart vacío.
 */
function EpochRocSection({ extras }: { extras: StageExtras }) {
  const { pytorch: pt, tensorflow: tf } = extras;
  const anyLoss = Boolean(pt.lossHistory?.length || tf.lossHistory?.length);
  const anyRoc = Boolean(pt.rocCurve || tf.rocCurve);

  return (
    <div className="space-y-4">
      {anyLoss && (
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Pérdida por época</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FrameworkColumnChart label="PyTorch">
              {pt.lossHistory?.length ? <LossCurveChart data={pt.lossHistory} /> : <p className="text-xs text-muted-foreground">Sin datos.</p>}
            </FrameworkColumnChart>
            <FrameworkColumnChart label="TensorFlow">
              {tf.lossHistory?.length ? <LossCurveChart data={tf.lossHistory} /> : <p className="text-xs text-muted-foreground">Sin datos.</p>}
            </FrameworkColumnChart>
          </div>
        </div>
      )}
      {anyRoc && (
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Curva ROC</p>
          <div className="flex flex-wrap justify-center gap-6">
            {pt.rocCurve && <FrameworkColumnChart label="PyTorch"><RocCurveChart data={pt.rocCurve} /></FrameworkColumnChart>}
            {tf.rocCurve && <FrameworkColumnChart label="TensorFlow"><RocCurveChart data={tf.rocCurve} /></FrameworkColumnChart>}
          </div>
        </div>
      )}
    </div>
  );
}

function StageChartsPanel({ stage, extras }: { stage: ExportComparisonStage; extras?: StageExtras }) {
  const anyAvailable = stage.pytorch.available || stage.tensorflow.available;
  const hasExtras = extras && (extras.pytorch.available || extras.tensorflow.available);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle>{stage.label}</CardTitle>
            {stage.recommendation && (
              <Badge variant={stage.recommendation === 'tie' ? 'default' : 'success'}>
                {stage.recommendation === 'tie' ? 'Empate' : stage.recommendation === 'pytorch' ? 'PyTorch gana' : 'TensorFlow gana'}
              </Badge>
            )}
          </div>
          <CardDescription>
            {anyAvailable
              ? `${stage.metricLabel} y métricas relacionadas — datos reales de la última búsqueda de Optuna con entrenamiento final.`
              : 'Todavía no hay ningún modelo entrenado en esta máquina para comparar.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {anyAvailable ? (
            <>
              <FrameworkComparisonChart data={buildChartData(stage)} format={stage.format} />
              {stage.format === 'decimal' && <DecimalSecondaryStats stage={stage} />}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Corré la búsqueda de Optuna de esta etapa con entrenamiento final (pestaña PyTorch/TensorFlow) para generar
              final_metrics.json.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pérdida por época y curva ROC</CardTitle>
          <CardDescription>
            {hasExtras
              ? 'Del entrenamiento simple (no de Optuna) más reciente de cada framework — Optuna no persiste ninguna de las dos.'
              : 'Esta etapa todavía no persiste pérdida por época ni curva ROC en disco (solo Stage 1 lo hace hoy — corré "07 · Clasificador MTG / no-MTG" / su equivalente TensorFlow para generarlas ahí).'}
          </CardDescription>
        </CardHeader>
        {hasExtras && (
          <CardContent>
            <EpochRocSection extras={extras!} />
          </CardContent>
        )}
      </Card>
    </div>
  );
}

/**
 * Pestaña "Charts" (ROADMAP.md N1) — comparación visual PyTorch vs
 * TensorFlow, una subpestaña por etapa (mismo patrón que FrameworkTab.tsx).
 * Solo lectura: mismo dato que "Exportar" (`GET /export/comparison`) para
 * la comparación de métricas, más `GET /charts/extras` para pérdida por
 * época/curva ROC donde estén persistidas en disco — sin botones de
 * exportar ni selector de framework, es puramente un dashboard.
 */
export function ChartsTab() {
  const [stage, setStage] = useState<StageValue>('stage1');
  const [stages, setStages] = useState<ExportComparisonStage[] | null>(null);
  const [extras, setExtras] = useState<StageExtras[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.exportComparison(), api.chartsExtras()])
      .then(([s, e]) => {
        setStages(s);
        setExtras(e);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Comparación visual PyTorch vs TensorFlow, una subpestaña por etapa — mismo dato que la pestaña "Exportar",
        más pérdida por época y curva ROC donde estén persistidas en disco.
      </p>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>No se pudo cargar la comparación</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!stages && !error && <p className="text-sm text-muted-foreground">Cargando métricas…</p>}

      {stages && (
        <>
          <Tabs value={stage} onValueChange={(v) => setStage(v as StageValue)} items={STAGES} />
          {STAGES.map(({ value }) => {
            const s = stages.find((st) => st.stage === value);
            if (!s) return null;
            return (
              <div key={value} className={cn('pt-4', value !== stage && 'hidden')}>
                <StageChartsPanel stage={s} extras={extras?.find((e) => e.stage === value)} />
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
