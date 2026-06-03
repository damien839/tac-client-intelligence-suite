"use client";

import { Reconciliation } from "@/lib/shipping-sim/types";
import { formatCurrency, formatPercent } from "@/lib/calculations";

interface ReconciliationBadgeProps {
  reconciliation: Reconciliation;
}

export default function ReconciliationBadge({ reconciliation }: ReconciliationBadgeProps) {
  const high = reconciliation.variancePct > 0.1;
  const overshoot = reconciliation.variancePct > 1;
  const text = overshoot
    ? `Current-scheme model is ${formatPercent(reconciliation.variancePct)} above actual shipping revenue`
    : `Current-scheme model reproduces ${formatPercent(1 - reconciliation.variancePct)} of actual shipping revenue`;

  return (
    <div
      className={`p-3 rounded-lg border text-sm ${
        high
          ? "bg-tac-danger/10 border-tac-danger/30 text-tac-danger"
          : "bg-tac-success/10 border-tac-success/30 text-tac-success"
      }`}
    >
      {text} ({formatCurrency(reconciliation.modelledCurrentRevenue)} modelled vs{" "}
      {formatCurrency(reconciliation.actualShippingPaid)} actually collected).
      {high
        ? " High variance — fix the current scheme before trusting the proposal."
        : " The entered current scheme matches reality, so the projection is sound."}
    </div>
  );
}
