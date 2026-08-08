import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

export interface RocCurveData {
  fpr: number[];
  tpr: number[];
}

const chartConfig = {
  tpr: { label: 'ROC (TPR vs FPR)', color: 'var(--chart-1)' },
} satisfies ChartConfig;

const DIAGONAL = [
  { fpr: 0, diag: 0 },
  { fpr: 1, diag: 1 },
];

export function RocCurveChart({ data, aucValue }: { data: RocCurveData; aucValue?: number }) {
  if (!data.fpr?.length) return null;
  const points = data.fpr.map((fpr, i) => ({ fpr, tpr: data.tpr[i] }));
  return (
    <ChartContainer config={chartConfig} className="aspect-square h-56 w-56">
      <LineChart margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
        <CartesianGrid />
        <XAxis
          type="number"
          dataKey="fpr"
          domain={[0, 1]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          label={{ value: 'FPR', position: 'insideBottom', offset: -4, fontSize: 11 }}
        />
        <YAxis type="number" dataKey="tpr" domain={[0, 1]} tickLine={false} axisLine={false} tickMargin={8} width={32} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" hideLabel />} />
        <Line
          data={DIAGONAL}
          dataKey="diag"
          stroke="hsl(215.4 16.3% 46.9%)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          dot={false}
          legendType="none"
          isAnimationActive={false}
        />
        <Line
          data={points}
          dataKey="tpr"
          type="monotone"
          stroke="var(--color-tpr)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          name={aucValue !== undefined ? `AUC = ${aucValue.toFixed(3)}` : 'ROC'}
        />
      </LineChart>
    </ChartContainer>
  );
}
