"use client";

import {
  CartesianGrid,
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
  curve: ThresholdCurvePoint[];
  currentThreshold: number | null;
  /** Reference lines for options that move THIS tier's free-over line. */
  markers: ThresholdMarker[];
  /** Display label of the swept tier (e.g. "Standard", "Express"). */
  tierLabel: string;
}

export default function ThresholdSensitivityChart({
  curve,
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
        How net shipping P&amp;L changes as the {tierLabel} free-over threshold moves, with the
        fee held at its current value. Steep regions are where the threshold decision matters.
        This isolates one lever — a candidate that also changes fees or another service&apos;s
        line will not sit exactly on this curve.
      </p>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={curve} margin={{ top: 16, right: 16, bottom: 4, left: 8 }}>
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
            dataKey="netShippingProfitDelta"
            name="Δ net shipping P&L"
            stroke="#F5B36B"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
