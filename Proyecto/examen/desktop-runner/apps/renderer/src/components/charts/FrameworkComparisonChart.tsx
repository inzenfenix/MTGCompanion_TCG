import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, type ChartConfig } from '@/components/ui/chart';

export interface ComparisonBarDatum {
  metric: string;
  pytorch?: number;
  tensorflow?: number;
}

const chartConfig = {
  pytorch: { label: 'PyTorch', color: 'var(--chart-1)' },
  tensorflow: { label: 'TensorFlow', color: 'var(--chart-2)' },
} satisfies ChartConfig;

const formatPercent = (value: unknown) => (typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : '—');
const formatDecimal = (value: unknown) => (typeof value === 'number' ? value.toFixed(3) : '—');

/**
 * Barras agrupadas PyTorch vs TensorFlow por métrica — pestaña "Charts"
 * (ROADMAP.md N1). A diferencia de MetricsBarChart (una sola serie, un
 * único run), esta compara dos series sobre el mismo set de métricas; una
 * barra faltante (framework sin entrenar todavía en esta máquina) se omite
 * en vez de graficarse como 0, para no leerse como "perdió" cuando en
 * realidad no hay dato.
 *
 * `format` sigue el mismo criterio que StageComparisonDef del server
 * (scripts.config.ts): 'percent' (default) fuerza el dominio [0,1] y
 * muestra "92.3%"; 'decimal' (Stage 3's R²) muestra "0.441" tal cual y deja
 * el dominio automático, para no mostrar un R² como si fuera un porcentaje.
 */
export function FrameworkComparisonChart({ data, format = 'percent' }: { data: ComparisonBarDatum[]; format?: 'percent' | 'decimal' }) {
  if (!data.length) return null;
  const formatValue = format === 'decimal' ? formatDecimal : formatPercent;
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
      <BarChart data={data} margin={{ top: 16 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="metric" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
        <YAxis domain={format === 'percent' ? [0, 1] : ['auto', 'auto']} tickLine={false} axisLine={false} tickMargin={8} width={32} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent formatter={(value) => formatValue(value)} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="pytorch" fill="var(--color-pytorch)" radius={4} isAnimationActive={false}>
          <LabelList dataKey="pytorch" position="top" fontSize={10} formatter={(v: unknown) => formatValue(v)} />
        </Bar>
        <Bar dataKey="tensorflow" fill="var(--color-tensorflow)" radius={4} isAnimationActive={false}>
          <LabelList dataKey="tensorflow" position="top" fontSize={10} formatter={(v: unknown) => formatValue(v)} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
