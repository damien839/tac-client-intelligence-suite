"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SchemeEvaluation } from "@/lib/shipping-sim/types";
import { AXIS_TICK, GRID_STROKE, ReportOption, TOOLTIP_STYLE } from "./types";

interface RecoveryFreeShareChartProps {
  options: ReportOption[];
  currentFacts: SchemeEvaluation;
}

export default function RecoveryFreeShareChart({
  options,
  currentFacts,
}: RecoveryFreeShareChartProps) {
  const data = [
    {
      name: "Current",
      recovery: currentFacts.recoveryRate * 100,
      freeShare: currentFacts.freeOrderShare * 100,
    },
    ...options.map((option) => ({
      name: option.shortLabel,
      recovery: option.evaluation.recoveryRate * 100,
      freeShare: option.evaluation.freeOrderShare * 100,
    })),
  ];

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-1 text-tac-accent">
        Cost recovery &amp; free-order share
      </h3>
      <p className="text-sm text-tac-muted mb-4">
        How much of the carrier bill customers fund (cost recovery) and how many orders ship
        free, under each option.
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="name" tick={AXIS_TICK} />
          <YAxis tick={AXIS_TICK} tickFormatter={(v) => `${v}%`} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v, name) => [`${Number(v).toFixed(1)}%`, String(name)]}
            cursor={{ fill: "rgba(160, 174, 184, 0.08)" }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="recovery" name="Cost recovery %" fill="#F5B36B" />
          <Bar dataKey="freeShare" name="Free-order share %" fill="#6088aa" />
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-tac-muted mt-2">
        Cost recovery = shipping fees collected ÷ carrier spend — 100% means customers fully fund
        shipping. Free-order share includes basket-builders.
      </p>
    </div>
  );
}
