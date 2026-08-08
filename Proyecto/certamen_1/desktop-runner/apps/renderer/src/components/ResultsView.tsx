import { Badge } from '@/components/ui/badge';
import type { ResultEvent } from '@/lib/api';
import { RocCurveChart, type RocCurveData } from './charts/RocCurveChart';
import { MetricsBarChart, type MetricBarDatum } from './charts/MetricsBarChart';

interface ScannerCandidate {
  rank: number;
  id?: string | null;
  name: string;
  similarity: number;
  set_name?: string | null;
  cmc?: number | null;
  colors?: string[] | null;
  rarity?: string | null;
}

interface ScannerData {
  framework: string;
  image: string;
  threshold: number;
  is_magic: boolean;
  detector?: { ran: boolean; is_mtg: boolean; probability: number; threshold: number } | null;
  top1: ScannerCandidate | null;
  candidates: ScannerCandidate[];
}

interface MetricsData {
  framework: string;
  backbone: string;
  n_gallery: number;
  n_query: number;
  top1_accuracy: number;
  top5_accuracy: number;
  mrr: number;
  accuracy_bin?: number;
  precision_bin?: number;
  recall_bin?: number;
  f1_bin?: number;
  roc_auc?: number;
  clasificacion?: { threshold_optimo: number; accuracy: number; precision: number; recall: number; f1: number; roc_auc: number };
  roc_curve?: RocCurveData;
  confusion_matrix_rarity?: { labels: string[]; matrix: number[][] };
}

function ConfusionMatrixGrid({ labels, matrix }: { labels: string[]; matrix: number[][] }) {
  const max = Math.max(1, ...matrix.flat());
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Matriz de confusión</p>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-xs">
          <thead>
            <tr>
              <th className="font-normal" />
              {labels.map((l) => (
                <th key={l} className="px-2 py-1 text-center font-normal text-muted-foreground">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, i) => (
              <tr key={labels[i] ?? i}>
                <th className="pr-2 text-right font-normal text-muted-foreground">{labels[i]}</th>
                {row.map((v, j) => {
                  const alpha = Math.max(0.08, v / max);
                  return (
                    <td
                      key={j}
                      className="h-9 min-w-9 rounded-sm text-center align-middle font-medium"
                      style={{ backgroundColor: `rgba(42, 120, 214, ${alpha})`, color: alpha > 0.5 ? '#fff' : undefined }}
                    >
                      {v.toLocaleString()}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const pct = (x: number | undefined | null) => (x === undefined || x === null ? '—' : `${(x * 100).toFixed(1)}%`);

function SimilarityBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary"
        style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
      />
    </div>
  );
}

function colorLabel(colors?: string[] | null) {
  if (!colors || colors.length === 0) return 'Colorless';
  const names: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
  return colors.map((c) => names[c] ?? c).join(' / ');
}

function ScannerResult({ data }: { data: ScannerData }) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <Badge variant={(data.is_magic ? 'success' : 'error') as any}>{data.is_magic ? 'Es Magic' : 'No es Magic'}</Badge>
        <span className="text-xs text-muted-foreground">Umbral: {pct(data.threshold)}</span>
      </div>

      {data.detector?.ran && (
        <p className="text-xs text-muted-foreground">
          Detector binario: P(MTG) = {pct(data.detector.probability)} (umbral {pct(data.detector.threshold)}) —{' '}
          {data.detector.is_mtg ? 'pasó' : 'rechazada'}
        </p>
      )}

      {data.top1 && (
        <div>
          <p className="text-xl font-semibold">{data.top1.name}</p>
          <p className="text-xs text-muted-foreground">
            {[data.top1.set_name, data.top1.rarity].filter(Boolean).join(' · ') || '—'}
          </p>
          <p className="mt-1 text-3xl font-bold text-primary">{pct(data.top1.similarity)}</p>
        </div>
      )}

      {data.candidates.length > 0 && (
        <div className="space-y-2 pt-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Candidatos</p>
          {data.candidates.map((c) => (
            <div key={c.rank} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">
                  #{c.rank} {c.name}
                  {c.set_name && <span className="text-muted-foreground"> · {c.set_name}</span>}
                  {c.colors !== undefined && <span className="text-muted-foreground"> · {colorLabel(c.colors)}</span>}
                </span>
                <span className="shrink-0 font-medium">{pct(c.similarity)}</span>
              </div>
              <SimilarityBar value={c.similarity} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function normalizeMetrics(m: MetricsData) {
  const c = m.clasificacion;
  return {
    backbone: m.backbone,
    n_gallery: m.n_gallery,
    n_query: m.n_query,
    top1_accuracy: m.top1_accuracy,
    top5_accuracy: m.top5_accuracy,
    mrr: m.mrr,
    accuracy: c ? c.accuracy : m.accuracy_bin,
    precision: c ? c.precision : m.precision_bin,
    recall: c ? c.recall : m.recall_bin,
    f1: c ? c.f1 : m.f1_bin,
    roc_auc: c ? c.roc_auc : m.roc_auc,
  };
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function MetricsResult({ data, label }: { data: MetricsData; label: string }) {
  const n = normalizeMetrics(data);
  const barData: MetricBarDatum[] = [
    { metric: 'Accuracy', value: n.accuracy ?? 0 },
    { metric: 'Precision', value: n.precision ?? 0 },
    { metric: 'Recall', value: n.recall ?? 0 },
    { metric: 'F1', value: n.f1 ?? 0 },
    { metric: 'ROC-AUC', value: n.roc_auc ?? 0 },
  ];
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <p className="text-sm font-medium">{label}</p>
        <span className="text-xs text-muted-foreground">
          {n.backbone} · galería {n.n_gallery?.toLocaleString()} · queries {n.n_query?.toLocaleString()}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Top-1 Accuracy" value={pct(n.top1_accuracy)} />
        <StatTile label="Top-5 Accuracy" value={pct(n.top5_accuracy)} />
        <StatTile label="MRR" value={n.mrr?.toFixed(3) ?? '—'} />
        <StatTile label="ROC-AUC" value={pct(n.roc_auc)} />
        <StatTile label="Precision" value={pct(n.precision)} />
        <StatTile label="Recall" value={pct(n.recall)} />
        <StatTile label="F1-Score" value={pct(n.f1)} />
        <StatTile label="Accuracy" value={pct(n.accuracy)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <MetricsBarChart data={barData} />
        {data.roc_curve && (
          <div className="flex justify-center">
            <RocCurveChart data={data.roc_curve} aucValue={n.roc_auc} />
          </div>
        )}
      </div>
      {data.confusion_matrix_rarity && (
        <ConfusionMatrixGrid labels={data.confusion_matrix_rarity.labels} matrix={data.confusion_matrix_rarity.matrix} />
      )}
    </div>
  );
}

interface OptunaData {
  trial_number: number;
  best_value: number;
  metric: string;
  params: Record<string, string | number | boolean>;
  study_name: string;
  completed_trials: number;
  total_trials: number;
}

function OptunaResult({ data, label }: { data: OptunaData; label: string }) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <p className="text-sm font-medium">{label}</p>
        <span className="text-xs text-muted-foreground">
          {data.completed_trials}/{data.total_trials} trials completados
        </span>
      </div>
      <div>
        <p className="text-[11px] text-muted-foreground">Mejor trial (#{data.trial_number}) — {data.metric}</p>
        <p className="text-3xl font-bold text-primary">{pct(data.best_value)}</p>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        {Object.entries(data.params ?? {}).map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-2 border-b border-border/50 py-1">
            <span className="text-muted-foreground">{k}</span>
            <span className="font-mono text-xs">{String(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ClassifierMetricsData {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  roc_auc: number;
  threshold: number;
  n_val: number;
  n_mtg_val?: number;
  n_no_mtg_val?: number;
  split?: string;
  roc_curve?: RocCurveData;
  confusion_matrix?: number[][];
}

function ClassifierMetricsResult({ data, label }: { data: ClassifierMetricsData; label: string }) {
  const barData: MetricBarDatum[] = [
    { metric: 'Accuracy', value: data.accuracy },
    { metric: 'Precision', value: data.precision },
    { metric: 'Recall', value: data.recall },
    { metric: 'F1', value: data.f1 },
    { metric: 'ROC-AUC', value: data.roc_auc },
  ];
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <p className="text-sm font-medium">{label}</p>
        <span className="text-xs text-muted-foreground">
          validación: {data.n_val?.toLocaleString()} imágenes (umbral {pct(data.threshold)})
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Accuracy" value={pct(data.accuracy)} />
        <StatTile label="Precision" value={pct(data.precision)} />
        <StatTile label="Recall" value={pct(data.recall)} />
        <StatTile label="F1-Score" value={pct(data.f1)} />
        <StatTile label="ROC-AUC" value={pct(data.roc_auc)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <MetricsBarChart data={barData} />
        {data.roc_curve && (
          <div className="flex justify-center">
            <RocCurveChart data={data.roc_curve} aucValue={data.roc_auc} />
          </div>
        )}
      </div>
      {data.confusion_matrix && <ConfusionMatrixGrid labels={['No MTG', 'MTG']} matrix={data.confusion_matrix} />}
    </div>
  );
}

export function ResultsView({ results }: { results: ResultEvent['results'] }) {
  if (!results.length) return null;
  return (
    <div className="space-y-3">
      {results.map((r, i) => {
        if (r.kind === 'scanner') return <ScannerResult key={i} data={r.data} />;
        if (r.kind === 'metrics') return <MetricsResult key={i} data={r.data} label={r.label} />;
        if (r.kind === 'optuna') return <OptunaResult key={i} data={r.data} label={r.label} />;
        if (r.kind === 'classifier-metrics') return <ClassifierMetricsResult key={i} data={r.data} label={r.label} />;
        return null;
      })}
    </div>
  );
}
