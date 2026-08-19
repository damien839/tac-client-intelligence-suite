"use client";

import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CurveStats } from "@/lib/shipping-sim/types";
import { AXIS_TICK, GRID_STROKE, NEUTRAL_COLOR, ACCENT_COLOR, TOOLTIP_STYLE } from "./types";

interface PullZoneChartProps {
  /** Never null — the parent only renders this when stats.pullZone exists. */
  pullZone: NonNullable<CurveStats["pullZone"]>;
}

export default function PullZoneChart({ pullZone }: PullZoneChartProps) {
  const { threshold, bands } = pullZone;
  const data = bands.map((b) => ({ label: `$${b.lo}`, lo: b.lo, n: b.n, above: b.lo >= threshold }));
  const runUp = bands.filter((b) => b.lo >= threshold - 25 && b.lo < threshold).reduce((t, b) => t + b.n, 0);
  const justAbove = bands.filter((b) => b.lo >= threshold && b.lo < threshold + 25).reduce((t, b) => t + b.n, 0);

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-1 text-tac-accent">
        How orders sit around the ${threshold} free-ship line
      </h3>
      <p className="text-sm text-tac-muted mb-4">
        Orders in $5 bands across your current free-ship line — a description of the book you
        uploaded, nothing more. The report does not infer intent from this shape, and no figure
        in the comparison grid depends on it.
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 16, right: 8, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="label" tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={12} />
          <YAxis tick={AXIS_TICK} allowDecimals={false} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v) => [`${v} orders`, "Orders"]}
            cursor={{ fill: "rgba(160, 174, 184, 0.08)" }}
          />
          <ReferenceLine
            x={`$${threshold}`}
            stroke="#C4604F"
            strokeDasharray="5 3"
            label={{ value: "free ship →", fontSize: 10, fill: "#C4604F", position: "top" }}
          />
          <Bar dataKey="n" radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.above ? ACCENT_COLOR : NEUTRAL_COLOR} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-tac-muted mt-2 border-l-2 border-l-tac-accent pl-3">
        {runUp} orders in the ${threshold - 25}–${threshold} run-up; {justAbove} just cross into ${threshold}–${threshold + 25}.
      </p>
    </div>
  );
}
