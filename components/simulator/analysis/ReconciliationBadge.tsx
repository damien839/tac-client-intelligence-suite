"use client";

import { Reconciliation } from "@/lib/shipping-sim/types";
import { reconciliationState } from "@/lib/shipping-sim/reconcile";
import { formatCurrency, formatPercent } from "@/lib/calculations";

interface ReconciliationBadgeProps {
  reconciliation: Reconciliation;
}

/**
 * Three states, never two. A file with no shipping revenue at all (summary export,
 * blank Shipping column) has nothing to check the entered scheme against — that is
 * an unknown, not a match, and must never render green.
 */
export default function ReconciliationBadge({ reconciliation }: ReconciliationBadgeProps) {
  const { actualShippingPaid, modelledCurrentRevenue, variancePct } = reconciliation;
  const state = reconciliationState(reconciliation);

  if (state === "unreconcilable") {
    return (
      <div className="p-3 rounded-lg border text-sm bg-tac-warning/10 border-tac-warning/30 text-tac-warning">
        Cannot reconcile — the uploaded file records no shipping revenue (
        {formatCurrency(actualShippingPaid)} collected) while the entered current scheme
        models {formatCurrency(modelledCurrentRevenue)}. Nothing verifies the scheme you
        entered, so treat every figure below as unchecked.
      </div>
    );
  }

  const high = state === "high";
  // Direction matters: when the model OVER-estimates, "reproduces X%" reads wrong.
  const over = modelledCurrentRevenue > actualShippingPaid;
  const text = over
    ? `Current-scheme model is ${formatPercent(variancePct)} above actual shipping revenue`
    : `Current-scheme model reproduces ${formatPercent(1 - variancePct)} of actual shipping revenue`;

  return (
    <div
      className={`p-3 rounded-lg border text-sm ${
        high
          ? "bg-tac-danger/10 border-tac-danger/30 text-tac-danger"
          : "bg-tac-success/10 border-tac-success/30 text-tac-success"
      }`}
    >
      {text} ({formatCurrency(modelledCurrentRevenue)} modelled vs{" "}
      {formatCurrency(actualShippingPaid)} actually collected).
      {high
        ? " High variance — fix the current scheme before trusting the proposal."
        : " The entered current scheme matches reality, so the projection is sound."}
    </div>
  );
}
