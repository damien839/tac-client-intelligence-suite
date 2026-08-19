import { Reconciliation, Scheme, SchemeEvaluation, TaggedOrder } from "./types";

/** How far the modelled current scheme may sit from actual before it is untrustworthy. */
export const RECONCILIATION_TOLERANCE = 0.1;

/**
 * Three outcomes, never two:
 * - "unreconcilable": the file records no shipping revenue at all, so there is
 *   nothing to check the entered scheme against. NOT a match — a summary export or
 *   a blank Shipping column must never render as a green "matches reality".
 * - "high": modelled revenue is more than the tolerance away from actual.
 * - "ok": modelled revenue reproduces actual within tolerance.
 */
export type ReconciliationState = "unreconcilable" | "high" | "ok";

export function reconciliationState(reconciliation: Reconciliation): ReconciliationState {
  if (reconciliation.actualShippingPaid <= 0) return "unreconcilable";
  return reconciliation.variancePct > RECONCILIATION_TOLERANCE ? "high" : "ok";
}

/**
 * Compare the modelled current scheme against the shipping revenue the CSV says was
 * actually collected. `variancePct` is 0 when nothing was collected; read the state
 * via `reconciliationState`, never the raw variance, or that 0 reads as a perfect match.
 */
export function buildReconciliation(
  orders: TaggedOrder[],
  currentFacts: SchemeEvaluation
): Reconciliation {
  const actualShippingPaid = orders.reduce((sum, order) => sum + order.shippingPaid, 0);
  const modelledCurrentRevenue = currentFacts.shippingRevenue;
  return {
    actualShippingPaid,
    modelledCurrentRevenue,
    variancePct:
      actualShippingPaid > 0
        ? Math.abs(modelledCurrentRevenue - actualShippingPaid) / actualShippingPaid
        : 0,
  };
}

/** Orders whose chosen tier exists in the scheme — the set reconciliation covers. */
export function reconcilableOrders(orders: TaggedOrder[], current: Scheme): TaggedOrder[] {
  return orders.filter((order) => current[order.tier] !== undefined);
}
