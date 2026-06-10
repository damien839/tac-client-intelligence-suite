"use client";

import { SchemeEvaluation } from "@/lib/shipping-sim/types";
import { ReportOption } from "./types";

interface OrderImpactTableProps {
  options: ReportOption[];
}

const ROWS: { label: string; value: (e: SchemeEvaluation) => number }[] = [
  { label: "Newly paying", value: (e) => e.impact.newlyPaying },
  { label: "Newly free", value: (e) => e.impact.newlyFree },
  { label: "Build baskets", value: (e) => e.impact.builders },
  { label: "Switch tier", value: (e) => e.impact.switchedTier },
  { label: "Abandon (expected)", value: (e) => e.expectedOrdersLost },
];

function renderCount(value: number): string {
  return value < 0.05 ? "—" : value.toFixed(1);
}

export default function OrderImpactTable({ options }: OrderImpactTableProps) {
  return (
    <div className="card overflow-x-auto">
      <h3 className="text-lg font-semibold mb-1 text-tac-accent">How each option moves orders</h3>
      <p className="text-sm text-tac-muted mb-4">
        What customers do differently under each option, in expected order counts: who starts
        paying for shipping, who ships free, who adds items to qualify, who switches service, who
        walks away.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-tac-border text-tac-muted">
            <th className="text-left py-2 pr-3 font-normal">Orders that…</th>
            {options.map((option) => (
              <th key={option.key} className="text-right py-2 px-3" style={{ color: option.color }}>
                {option.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.label} className="border-b border-tac-border/30">
              <td className="py-2 pr-3 text-tac-muted">{row.label}</td>
              {options.map((option) => (
                <td key={option.key} className="text-right py-2 px-3">
                  {renderCount(row.value(option.evaluation))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-tac-muted mt-3">
        Counts are modelled averages — fractions reflect probabilities, not whole orders.
        Basket-builders are counted separately, not as newly free.
      </p>
    </div>
  );
}
