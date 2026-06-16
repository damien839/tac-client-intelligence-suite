"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ThresholdCurvePoint } from "@/lib/shipping-sim/types";
import { formatCurrency } from "@/lib/calculations";
import { AXIS_TICK, GRID_STROKE, NEUTRAL_COLOR, ThresholdMarker, TOOLTIP_STYLE } from "./types";

interface ThresholdSensitivityChartProps {
  curves: ThresholdCurvePoint[];
  currentThreshold: number | null;
  /** Reference lines for options that move THIS tier's free-over line. */
  markers: ThresholdMarker[];
  /** Display label of the swept tier (e.g. "Standard", "Express"). */
  tierLabel: string;
}

export default function ThresholdSensitivityChart({
  curves,
  currentThreshold,
  markers,
  tierLabel,
}: ThresholdSensitivityChartProps) {
  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-1 text-tac-accent">
        Threshold sensitivity — {tierLabel} free-over line
      </h3>
      <p className="text-sm text-tac-muted mb-4">
        How the outcome changes as the {tierLabel} free-over threshold moves (fee held at
        current). The gap between the lines is the basket-building effect; steep regions are
        where the threshold decision matters. This isolates one lever — the Cost-recovery
        optimiser may move several at once (fees and the other service&apos;s line), which this
        curve can&apos;t show.
      </p>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={curves} margin={{ top: 16, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis
            dataKey="threshold"
            type="number"
            domain={[0, "dataMax"]}
            tick={AXIS_TICK}
            tickFormatter={(v) => `$${v}`}
          />
          <YAxis tick={AXIS_TICK} tickFormatter={(v) => formatCurrency(Number(v), 0)} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v, name) => [formatCurrency(Number(v)), String(name)]}
            labelFormatter={(l) => `Free over $${l}`}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {currentThreshold !== null && (
            <ReferenceLine
              x={currentThreshold}
              stroke={NEUTRAL_COLOR}
              strokeDasharray="3 3"
              label={{ value: "now", fontSize: 10, fill: NEUTRAL_COLOR, position: "top" }}
            />
          )}
          {markers.map((marker) => (
            <ReferenceLine
              key={`${marker.label}-${marker.value}`}
              x={marker.value}
              stroke={marker.color}
              strokeDasharray="3 3"
              label={{
                value: marker.label,
                fontSize: 10,
                fill: marker.color,
                position: "top",
              }}
            />
          ))}
          <ReferenceLine y={0} stroke={GRID_STROKE} />
          <Line
            type="monotone"
            dataKey="contributionNoUplift"
            name="Without basket-building"
            stroke="#6088aa"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="contributionWithUplift"
            name="With basket-building"
            stroke="#4ADE80"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
