import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

export interface MetricBarDatum {
  metric: string;
  value: number;
}

const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

const chartConfig = {
  value: { label: 'Score' },
} satisfies ChartConfig;

export function MetricsBarChart({ data }: { data: MetricBarDatum[] }) {
  if (!data.length) return null;
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-48 w-full">
      <BarChart data={data} margin={{ top: 16 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="metric" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
        <YAxis domain={[0, 1]} tickLine={false} axisLine={false} tickMargin={8} width={32} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel formatter={(value) => `${(Number(value) * 100).toFixed(1)}%`} />} />
        <Bar dataKey="value" radius={4} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={d.metric} fill={COLORS[i % COLORS.length]} />
          ))}
          <LabelList dataKey="value" position="top" fontSize={11} formatter={(value: unknown) => `${(Number(value) * 100).toFixed(1)}%`} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
