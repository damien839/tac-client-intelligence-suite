"use client";

import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CurveStats } from "@/lib/shipping-sim/types";
import { formatCurrency } from "@/lib/calculations";
import { AXIS_TICK, GRID_STROKE, NEUTRAL_COLOR, OPTION_COLORS, TOOLTIP_STYLE } from "./types";

interface DistributionChartProps {
  stats: CurveStats;
  /** Dominant tier's current free-ship line — bands at/above it are shaded as the free zone. */
  currentThreshold: number | null;
}

const ACCENT = OPTION_COLORS["net-profit"]; // tac orange, matches the report palette

const PERCENTILE_ROWS: { key: keyof CurveStats["percentiles"]; label: string }[] = [
  { key: "p10", label: "p10" },
  { key: "p25", label: "p25" },
  { key: "p50", label: "p50 (median)" },
  { key: "p75", label: "p75" },
  { key: "p90", label: "p90" },
  { key: "p95", label: "p95" },
  { key: "p99", label: "p99" },
];

export default function DistributionChart({ stats, currentThreshold }: DistributionChartProps) {
  const data = stats.histogram.map((b) => ({
    label: b.hi === null ? `$${b.lo}+` : `$${b.lo}`,
    lo: b.lo,
    n: b.n,
    free: currentThreshold !== null && b.lo >= currentThreshold,
  }));
  const maxP = stats.percentiles.p99 || 1;

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-1 text-tac-accent">The order-value curve, not the average</h3>
      <p className="text-sm text-tac-muted mb-4">
        The full distribution of order subtotals in $25 bands, beside the percentile ladder. A
        single &ldquo;average&rdquo; hides this shape.
      </p>
      <div className="grid md:grid-cols-[1.6fr_1fr] gap-6 items-start">
        <div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="label" tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={16} />
              <YAxis tick={AXIS_TICK} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v) => [`${v} orders`, "Orders"]}
                cursor={{ fill: "rgba(160, 174, 184, 0.08)" }}
              />
              <Bar dataKey="n" radius={[2, 2, 0, 0]}>
                {data.map((d, i) => (
                  <Cell key={i} fill={d.free ? ACCENT : NEUTRAL_COLOR} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {currentThreshold !== null && (
            <p className="text-xs text-tac-muted mt-2">
              Orange bands ship free today (≥ ${currentThreshold}); grey bands pay shipping.
            </p>
          )}
        </div>
        <div>
          <div className="flex flex-col gap-2">
            {PERCENTILE_ROWS.map(({ key, label }) => {
              const v = stats.percentiles[key];
              return (
                <div key={key} className="grid grid-cols-[88px_1fr_64px] items-center gap-2 text-sm">
                  <span className="text-tac-muted text-xs">{label}</span>
                  <span className="h-2 rounded-sm bg-tac-accent/60" style={{ width: `${Math.max(4, (v / maxP) * 100)}%` }} />
                  <span className="text-right tabular-nums">{formatCurrency(v, 0)}</span>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-tac-muted mt-4 border-l-2 border-l-tac-accent pl-3">
            Mean {formatCurrency(stats.mean, 0)} vs median {formatCurrency(stats.median, 0)} — a{" "}
            {stats.skewPct.toFixed(0)}% right-skew. Half your orders sit below{" "}
            {formatCurrency(stats.median, 0)}; the top 1% reach {formatCurrency(stats.percentiles.p99, 0)} (max{" "}
            {formatCurrency(stats.max, 0)}).
          </p>
        </div>
      </div>
    </div>
  );
}
