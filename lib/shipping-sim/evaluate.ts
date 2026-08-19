import {
  baselineNetOf,
  bucketOrders,
  dominantPaidTier,
  mechanicalScenario,
  prepareBuckets,
  thresholdCandidates,
} from "./scenario";
import {
  CANONICAL_TIERS,
  CanonicalTier,
  Scheme,
  SchemeEvaluation,
  TaggedOrder,
  ThresholdCurvePoint,
} from "./types";

/** Tiers whose fee or free threshold differ between the two schemes. */
export function changedTiersOf(current: Scheme, candidate: Scheme): CanonicalTier[] {
  return CANONICAL_TIERS.filter((tier) => {
    const a = current[tier];
    const b = candidate[tier];
    if (!a && !b) return false;
    if (!a || !b) return true;
    return a.fee !== b.fee || a.freeThreshold !== b.freeThreshold;
  });
}

/** Orders the engine can analyse: those whose chosen tier exists in the current scheme. */
export function analysableOrders(orders: TaggedOrder[], current: Scheme): TaggedOrder[] {
  return orders.filter((order) => current[order.tier] !== undefined);
}

/**
 * Evaluate one candidate scheme mechanically against the current scheme:
 * same orders, same volume, only the landed tier / fee / carrier cost can move.
 * Returns null when no uploaded order maps to a service in the current scheme.
 */
export function evaluateScheme(
  orders: TaggedOrder[],
  current: Scheme,
  candidate: Scheme
): SchemeEvaluation | null {
  const valid = analysableOrders(orders, current);
  if (valid.length === 0) return null;
  const prepared = prepareBuckets(bucketOrders(valid), current);
  const currentResult = mechanicalScenario(prepared, current);
  const result = mechanicalScenario(prepared, candidate);
  const shippingRevenueDelta = result.shippingRevenue - currentResult.shippingRevenue;
  const carrierSpendDelta = result.carrierSpend - currentResult.carrierSpend;
  return {
    shippingRevenue: result.shippingRevenue,
    carrierSpend: result.carrierSpend,
    netShippingProfit: result.netShippingProfit,
    shippingRevenueDelta,
    carrierSpendDelta,
    netShippingProfitDelta: shippingRevenueDelta - carrierSpendDelta,
    recoveryRate: result.recoveryRate,
    recoveryRateCurrent: currentResult.recoveryRate,
    freeOrderShare: result.freeOrderShare,
    orderCount: valid.length,
    volumeByTier: result.volumeByTier,
    carrierSpendByTier: result.carrierSpendByTier,
    impact: result.impact,
  };
}

/**
 * Net-shipping-P&L-vs-threshold curve for the sensitivity chart: the dominant paid
 * tier's free-over threshold sweeps the $10 candidate grid with its fee held at the
 * current value. Purely mechanical — one line, no behavioural variant.
 */
export function thresholdCurve(
  orders: TaggedOrder[],
  current: Scheme
): ThresholdCurvePoint[] {
  const tier = dominantPaidTier(orders, current);
  if (!tier) return [];
  const target = current[tier]!;
  const valid = analysableOrders(orders, current);
  if (valid.length === 0) return [];
  const prepared = prepareBuckets(bucketOrders(valid), current);
  const baselineNet = baselineNetOf(prepared, current);
  return thresholdCandidates(valid).map((threshold) => {
    const candidate: Scheme = { ...current, [tier]: { ...target, freeThreshold: threshold } };
    const result = mechanicalScenario(prepared, candidate);
    return { threshold, netShippingProfitDelta: result.netShippingProfit - baselineNet };
  });
}
