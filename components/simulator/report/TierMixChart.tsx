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
import {
  CANONICAL_TIERS,
  CanonicalTier,
  SchemeEvaluation,
  TIER_LABELS,
} from "@/lib/shipping-sim/types";
import { AXIS_TICK, GRID_STROKE, ReportOption, TIER_COLORS, TOOLTIP_STYLE } from "./types";

interface TierMixChartProps {
  options: ReportOption[];
  currentFacts: SchemeEvaluation;
}

export default function TierMixChart({ options, currentFacts }: TierMixChartProps) {
  // Only chart tiers that actually carry volume in at least one column.
  const usedTiers: CanonicalTier[] = CANONICAL_TIERS.filter(
    (tier) =>
      currentFacts.volumeByTier[tier] > 0 ||
      options.some((option) => option.evaluation.volumeByTier[tier] > 0)
  );

  const data = [
    {
      name: "Current",
      ...Object.fromEntries(usedTiers.map((tier) => [tier, currentFacts.volumeByTier[tier]])),
    },
    ...options.map((option) => ({
      name: option.shortLabel,
      ...Object.fromEntries(usedTiers.map((tier) => [tier, option.evaluation.volumeByTier[tier]])),
    })),
  ];

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-2 text-tac-accent">Tier volume mix</h3>
      <p className="text-sm text-tac-muted mb-4">
        How many orders ship on each service under each option — watch for volume shifting
        between services and the carrier-cost change in the table above.
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="name" tick={AXIS_TICK} />
          <YAxis tick={AXIS_TICK} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v, name) => [Number(v).toFixed(1), String(name)]}
            cursor={{ fill: "rgba(160, 174, 184, 0.08)" }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {usedTiers.map((tier) => (
            <Bar key={tier} dataKey={tier} name={TIER_LABELS[tier]} fill={TIER_COLORS[tier]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
