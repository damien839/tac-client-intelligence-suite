"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SchemeEvaluation } from "@/lib/shipping-sim/types";
import { formatCurrency } from "@/lib/calculations";
import { AXIS_TICK, GRID_STROKE, ReportOption, TOOLTIP_STYLE } from "./types";

interface ContributionDecompositionProps {
  options: ReportOption[];
  currentFacts: SchemeEvaluation;
}

const SERIES = [
  { key: "feeRevenue", label: "Δ fee revenue", color: "#F5B36B" },
  { key: "carrierSaving", label: "Carrier saving", color: "#6088aa" },
  { key: "basketMargin", label: "Basket margin", color: "#4ADE80" },
  { key: "abandonment", label: "Abandonment", color: "#E26D6D" },
] as const;

export default function ContributionDecomposition({
  options,
  currentFacts,
}: ContributionDecompositionProps) {
  const data = options.map((option) => ({
    name: option.shortLabel,
    feeRevenue: option.evaluation.shippingRevenue - currentFacts.shippingRevenue,
    carrierSaving: currentFacts.carrierSpend - option.evaluation.carrierSpend,
    basketMargin: option.evaluation.upliftMarginGain,
    abandonment: -option.evaluation.abandonMarginLoss,
  }));

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-4 text-tac-accent">
        Where each option&apos;s contribution comes from
      </h3>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="name" tick={AXIS_TICK} />
          <YAxis tick={AXIS_TICK} tickFormatter={(v) => formatCurrency(Number(v), 0)} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v, name) => [formatCurrency(Number(v)), String(name)]}
            cursor={{ fill: "rgba(160, 174, 184, 0.08)" }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine y={0} stroke={GRID_STROKE} />
          {SERIES.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} stackId="contribution" fill={s.color} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-tac-muted mt-2">
        Stacked components of each option&apos;s expected impact vs current: change in shipping fee
        revenue, carrier saving (positive = spend falls), product margin gained from
        basket-building, and product margin lost to abandonment (negative). Each stack nets to the
        option&apos;s Δ total contribution in the table above.
      </p>
    </div>
  );
}
