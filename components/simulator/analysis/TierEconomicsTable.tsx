"use client";

import { TierEconomics } from "@/lib/shipping-sim/types";
import { TIER_LABELS } from "@/lib/shipping-sim/types";
import { formatCurrency, formatPercent } from "@/lib/calculations";

interface TierEconomicsTableProps {
  current: TierEconomics[];
  proposed: TierEconomics[];
}

export default function TierEconomicsTable({ current, proposed }: TierEconomicsTableProps) {
  // Both arrays cover the same tier set, in the same order (from analyze()).
  const rows = current.map((c, i) => ({ c, p: proposed[i] })).filter((r) => r.c.count > 0 || r.p.count > 0);

  return (
    <div className="card overflow-x-auto">
      <h3 className="text-lg font-semibold mb-4 text-tac-accent">
        Per-tier economics{" "}
        <span className="text-xs font-normal text-tac-muted">(current → proposed)</span>
      </h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-tac-border text-tac-muted">
            <th className="text-left py-2">Tier</th>
            <th className="text-right py-2 px-3">Orders</th>
            <th className="text-right py-2 px-3">Fee revenue</th>
            <th className="text-right py-2 px-3">Carrier cost</th>
            <th className="text-right py-2 px-3">Net</th>
            <th className="text-right py-2 px-3">Recovery</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ c, p }) => (
            <tr key={c.tier} className="border-b border-tac-border/50">
              <td className="py-2 font-medium">{TIER_LABELS[c.tier]}</td>
              <td className="text-right px-3">
                {c.count} → {p.count}
              </td>
              <td className="text-right px-3">
                {formatCurrency(c.feeRevenue)} → {formatCurrency(p.feeRevenue)}
              </td>
              <td className="text-right px-3">
                {formatCurrency(c.carrierCost)} → {formatCurrency(p.carrierCost)}
              </td>
              <td className="text-right px-3">
                {formatCurrency(c.net)} → <strong>{formatCurrency(p.net)}</strong>
              </td>
              <td
                className={`text-right px-3 ${
                  p.recoveryRate >= c.recoveryRate ? "text-tac-success" : "text-tac-danger"
                }`}
              >
                {formatPercent(c.recoveryRate, 0)} → {formatPercent(p.recoveryRate, 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
