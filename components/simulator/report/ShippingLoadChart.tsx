"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CurveStats } from "@/lib/shipping-sim/types";
import { formatCurrency } from "@/lib/calculations";
import { AXIS_TICK, GRID_STROKE, TOOLTIP_STYLE } from "./types";

interface ShippingLoadChartProps {
  stats: CurveStats;
  tierLabel: string;
}

export default function ShippingLoadChart({ stats, tierLabel }: ShippingLoadChartProps) {
  if (stats.shippingLoad.length === 0) return null;
  const data = stats.shippingLoad.map((b) => ({ label: `$${b.lo}`, loadPct: Math.round(b.loadPct * 10) / 10, n: b.n }));
  const medLoad = stats.median > 0 ? data.find((d) => d.loadPct > 0)?.loadPct : 0;

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-1 text-tac-accent">Shipping load across the curve</h3>
      <p className="text-sm text-tac-muted mb-4">
        The {tierLabel.toLowerCase()} charge as a % of order value, by band. The smallest carts
        carry the heaviest load — the shipping fee is the largest share of what they are worth.
      </p>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="label" tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={16} />
          <YAxis tick={AXIS_TICK} tickFormatter={(v) => `${v}%`} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v, _name, item) => [
              `${v}% of order value · ${item?.payload?.n ?? 0} orders`,
              "Shipping load",
            ]}
          />
          <Line type="monotone" dataKey="loadPct" stroke="#C4604F" strokeWidth={2} dot={{ r: 2 }} />
        </LineChart>
      </ResponsiveContainer>
      {medLoad !== undefined && medLoad > 0 && (
        <p className="text-xs text-tac-muted mt-2 border-l-2 border-l-tac-accent pl-3">
          Around the median order ({formatCurrency(stats.median, 0)}) the fee is at its heaviest
          share of order value.
        </p>
      )}
    </div>
  );
}
