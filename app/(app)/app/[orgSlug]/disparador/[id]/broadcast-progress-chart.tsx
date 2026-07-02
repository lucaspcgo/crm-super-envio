"use client";

import { Cell, Pie, PieChart } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

const config = {
  sent: { label: "Enviados", color: "var(--color-chart-1)" },
  failed: { label: "Falhas", color: "var(--color-destructive)" },
  remaining: { label: "Restantes", color: "var(--color-muted-foreground)" },
} satisfies ChartConfig;

type Props = { sent: number; failed: number; remaining: number };

export function BroadcastProgressChart({ sent, failed, remaining }: Props) {
  const data = [
    { key: "sent", value: sent, fill: "var(--color-sent)" },
    { key: "failed", value: failed, fill: "var(--color-failed)" },
    { key: "remaining", value: remaining, fill: "var(--color-remaining)" },
  ].filter((d) => d.value > 0);

  if (data.length === 0) return null;

  return (
    <ChartContainer config={config} className="aspect-square h-[180px] w-[180px]">
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent nameKey="key" hideLabel />} />
        <Pie
          data={data}
          dataKey="value"
          nameKey="key"
          innerRadius={48}
          outerRadius={78}
          strokeWidth={2}
          isAnimationActive={false}
        >
          {data.map((d) => (
            <Cell key={d.key} fill={d.fill} stroke="var(--color-card)" />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}
