import { CartesianGrid, Legend, Line, LineChart, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

export interface EpochPoint {
  epoch: number;
  train_loss: number;
  val_loss: number;
}

const chartConfig = {
  train_loss: { label: 'Train Loss', color: 'var(--chart-1)' },
  val_loss: { label: 'Val Loss', color: 'var(--chart-2)' },
} satisfies ChartConfig;

export function LossCurveChart({ data }: { data: EpochPoint[] }) {
  if (!data.length) return null;
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-48 w-full">
      <LineChart data={data} margin={{ left: 4, right: 12, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="epoch"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          label={{ value: 'Época', position: 'insideBottom', offset: -4, fontSize: 11 }}
        />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={40} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
        <Line dataKey="train_loss" type="monotone" stroke="var(--color-train_loss)" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="val_loss" type="monotone" stroke="var(--color-val_loss)" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Legend content={<ChartLegendContent />} />
      </LineChart>
    </ChartContainer>
  );
}
