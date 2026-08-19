"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CurveStats } from "@/lib/shipping-sim/types";
import { formatCurrency } from "@/lib/calculations";
import { AXIS_TICK, GRID_STROKE, OPTION_COLORS, TOOLTIP_STYLE } from "./types";

interface PricePointBarsProps {
  stats: CurveStats;
}

export default function PricePointBars({ stats }: PricePointBarsProps) {
  if (stats.pricePoints.length === 0) return null;
  const data = stats.pricePoints.map((p) => ({ label: formatCurrency(p.value), n: p.n }));
  const top = stats.pricePoints[0];

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-1 text-tac-accent">Where orders pile up — price points</h3>
      <p className="text-sm text-tac-muted mb-4">
        The most common exact subtotals. Orders stacking on single-item prices is the signature of a
        one-item basket — the growth lever is moving people from one item to two.
      </p>
      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 26)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
          <XAxis type="number" tick={AXIS_TICK} />
          <YAxis type="category" dataKey="label" tick={AXIS_TICK} width={72} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v) => [`${v} orders`, "At this exact value"]}
            cursor={{ fill: "rgba(160, 174, 184, 0.08)" }}
          />
          <Bar dataKey="n" fill={OPTION_COLORS["net-profit"]} radius={[0, 2, 2, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-tac-muted mt-2 border-l-2 border-l-tac-accent pl-3">
        {formatCurrency(top.value)} alone accounts for {top.n} orders.
      </p>
    </div>
  );
}
