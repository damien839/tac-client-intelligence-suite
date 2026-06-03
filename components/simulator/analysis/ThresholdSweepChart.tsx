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
import { ThresholdSweepPoint } from "@/lib/shipping-sim/types";
import { formatCurrency } from "@/lib/calculations";

interface ThresholdSweepChartProps {
  sweep: ThresholdSweepPoint[];
  optimalThreshold: number;
  optimalNet: number;
  currentThreshold: number;
  proposedThreshold: number;
}

const TOOLTIP_STYLE = {
  backgroundColor: "#1F3040",
  border: "1px solid #2D4050",
  borderRadius: 8,
  color: "#fff",
};

export default function ThresholdSweepChart({
  sweep,
  optimalThreshold,
  optimalNet,
  currentThreshold,
  proposedThreshold,
}: ThresholdSweepChartProps) {
  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-4 text-tac-accent">
        Threshold sensitivity — standard free-over line
      </h3>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={sweep} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2D4050" />
          <XAxis
            dataKey="threshold"
            type="number"
            domain={[0, "dataMax"]}
            tick={{ fontSize: 11, fill: "#A0AEB8" }}
            tickFormatter={(v) => `$${v}`}
          />
          <YAxis tick={{ fontSize: 11, fill: "#A0AEB8" }} tickFormatter={(v) => `$${v}`} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v) => [formatCurrency(Number(v)), "Net shipping profit"]}
            labelFormatter={(l) => `Free over $${l}`}
          />
          <ReferenceLine x={currentThreshold} stroke="#A0AEB8" strokeDasharray="3 3" label={{ value: "now", fontSize: 10, fill: "#A0AEB8", position: "top" }} />
          <ReferenceLine x={proposedThreshold} stroke="#F5B36B" strokeDasharray="3 3" label={{ value: "proposed", fontSize: 10, fill: "#F5B36B", position: "top" }} />
          <ReferenceLine x={optimalThreshold} stroke="#4ADE80" strokeDasharray="3 3" label={{ value: "optimal", fontSize: 10, fill: "#4ADE80", position: "top" }} />
          <ReferenceLine y={0} stroke="#2D4050" />
          <Line type="monotone" dataKey="netShippingProfit" stroke="#6088aa" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
      <p className="text-xs text-tac-muted mt-2">
        Net shipping profit as the standard free-over threshold sweeps $0–$400 (rest of proposal
        fixed). Optimal ≈ <strong className="text-tac-success">${optimalThreshold}</strong> at{" "}
        {formatCurrency(optimalNet)}. Proposed ${proposedThreshold} captures most of the available gain.
      </p>
    </div>
  );
}
