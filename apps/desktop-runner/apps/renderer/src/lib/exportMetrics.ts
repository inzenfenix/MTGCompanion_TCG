/**
 * Formateo/lectura de métricas de `final_metrics.json`, compartido entre
 * `ExportPanel.tsx` (comparación PyTorch/TensorFlow con acción de exportar)
 * y `ChartsTab.tsx` (mismo dato, solo lectura, visual) — ROADMAP.md N1.
 * Vivía como helpers privados de ExportPanel.tsx; se extrajo acá para que
 * las dos pestañas no mantengan dos copias de la misma lógica.
 */

export const pct = (x: number | undefined | null) => (typeof x === 'number' ? `${(x * 100).toFixed(2)}%` : '—');
export const decimal = (x: number | undefined | null) => (typeof x === 'number' ? x.toFixed(3) : '—');
export const formatMetric = (x: number | undefined | null, format: 'percent' | 'decimal' | undefined) =>
  format === 'decimal' ? decimal(x) : pct(x);

/** Lee `key` de `m`, con soporte para paths con puntos (ej. "log_space.r2") — mismo criterio que readMetric() en scripts.service.ts (server). */
export function getMetric(m: Record<string, any>, key: string): number | undefined {
  const value = key.split('.').reduce<any>((acc, k) => (acc && typeof acc === 'object' ? acc[k] : undefined), m);
  return typeof value === 'number' ? value : undefined;
}

// Métricas secundarias por etapa, en el orden en que se muestran debajo del
// valor principal de la comparación (metricKey ya se ve arriba, no se repite acá).
export const SECONDARY_METRICS: Record<string, { key: string; label: string }[]> = {
  stage1: [
    { key: 'precision', label: 'Precision' },
    { key: 'recall', label: 'Recall' },
    { key: 'f1', label: 'F1' },
    { key: 'roc_auc', label: 'ROC-AUC' },
  ],
  stage2: [
    { key: 'accuracy_en_umbral_optimo', label: 'Accuracy (umbral óptimo)' },
    { key: 'umbral_optimo', label: 'Umbral óptimo' },
  ],
  stage3: [
    { key: 'log_space.mae', label: 'MAE (log-USD)' },
    { key: 'usd_space.mae', label: 'MAE (USD)' },
    { key: 'usd_space.median_ae', label: 'Mediana AE (USD)' },
  ],
  stage4: [
    { key: 'precision_macro', label: 'Precision (macro)' },
    { key: 'recall_macro', label: 'Recall (macro)' },
    { key: 'accuracy', label: 'Accuracy' },
  ],
};
