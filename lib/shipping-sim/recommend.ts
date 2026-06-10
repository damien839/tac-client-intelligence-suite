import { revealedPremium } from "./model";
import { cheapestTier, tierCost } from "./tiers";
import {
  BehavioralResult,
  BehaviorParams,
  CanonicalTier,
  OrderBucket,
  Scheme,
  TaggedOrder,
} from "./types";

/** Above this many distinct (tier, gross) pairs, gross is rounded to the dollar. */
const MAX_EXACT_BUCKETS = 5000;

/**
 * Group orders that behave identically under the model. Exact (tier, gross)
 * grouping first; falls back to dollar-rounded gross on pathological data so
 * sweep cost stays bounded.
 */
export function bucketOrders(orders: TaggedOrder[]): OrderBucket[] {
  const build = (round: boolean): OrderBucket[] => {
    const map = new Map<string, OrderBucket>();
    for (const order of orders) {
      const gross = round ? Math.round(order.gross) : order.gross;
      const key = `${order.tier}|${gross}`;
      const existing = map.get(key);
      map.set(
        key,
        existing
          ? { ...existing, count: existing.count + 1 }
          : { tier: order.tier, gross, count: 1 }
      );
    }
    return Array.from(map.values());
  };
  const exact = build(false);
  return exact.length > MAX_EXACT_BUCKETS ? build(true) : exact;
}

/** A bucket enriched with candidate-independent facts about the current scheme. */
export interface PreparedBucket extends OrderBucket {
  currentFee: number; // shipping the bucket pays under the current scheme
  premium: number; // revealed WTP premium under the current scheme
}

/**
 * Precompute the candidate-independent half of the model once per recommendation
 * run; sweeps then only evaluate the candidate-dependent half per bucket.
 */
export function prepareBuckets(buckets: OrderBucket[], current: Scheme): PreparedBucket[] {
  return buckets.map((bucket) => {
    const order: TaggedOrder = {
      gross: bucket.gross,
      shippingPaid: 0,
      rawService: "",
      tier: bucket.tier,
    };
    return {
      ...bucket,
      currentFee: tierCost(current[bucket.tier]!, bucket.gross),
      premium: revealedPremium(order, current),
    };
  });
}

/**
 * Expected-value outcome of one candidate scheme. Per bucket:
 * 1. Land via revealed-WTP (same rule as landedTier, using the cached premium).
 * 2. Basket-building: in-window paying orders build to the threshold with
 *    weight upliftRate — ship free, carrier cost unchanged, gain product margin.
 * 3. Abandonment: of the remaining weight, worse-off orders (landed fee above
 *    current fee) abandon with weight abandonRate — lose product margin.
 * 4. The rest pay the landed fee.
 */
export function behavioralScenario(
  buckets: PreparedBucket[],
  candidate: Scheme,
  behavior: BehaviorParams
): BehavioralResult {
  const { cogsPercent, upliftRate, upliftWindow, abandonRate } = behavior;
  let shippingRevenue = 0;
  let carrierSpend = 0;
  let upliftMarginGain = 0;
  let abandonMarginLoss = 0;
  let expectedOrdersLost = 0;
  let freeOrders = 0;
  let completingOrders = 0;

  for (const bucket of buckets) {
    const cheapest = cheapestTier(candidate, bucket.gross);
    const chosen = candidate[bucket.tier];
    let landed: CanonicalTier;
    if (!chosen) {
      landed = cheapest.tier;
    } else {
      const stayPremium = tierCost(chosen, bucket.gross) - cheapest.cost;
      landed = stayPremium <= bucket.premium ? bucket.tier : cheapest.tier;
    }
    const landedConfig = candidate[landed]!;
    const landedFee = tierCost(landedConfig, bucket.gross);
    const threshold = landedConfig.freeThreshold;

    // landedFee > 0 with a non-null threshold implies gross < threshold.
    const inWindow =
      threshold !== null && landedFee > 0 && bucket.gross >= threshold - upliftWindow;
    const buildWeight = inWindow ? upliftRate : 0;
    const worseOff = landedFee > bucket.currentFee;
    const abandonWeight = worseOff ? (1 - buildWeight) * abandonRate : 0;
    const payWeight = 1 - buildWeight - abandonWeight;

    shippingRevenue += payWeight * landedFee * bucket.count;
    carrierSpend += (buildWeight + payWeight) * landedConfig.avgCost * bucket.count;
    if (buildWeight > 0) {
      upliftMarginGain +=
        buildWeight * (threshold! - bucket.gross) * (1 - cogsPercent) * bucket.count;
    }
    abandonMarginLoss += abandonWeight * bucket.gross * (1 - cogsPercent) * bucket.count;
    expectedOrdersLost += abandonWeight * bucket.count;
    freeOrders += (buildWeight + (landedFee === 0 ? payWeight : 0)) * bucket.count;
    completingOrders += (buildWeight + payWeight) * bucket.count;
  }

  return {
    shippingRevenue,
    carrierSpend,
    netShippingProfit: shippingRevenue - carrierSpend,
    upliftMarginGain,
    abandonMarginLoss,
    expectedOrdersLost,
    freeOrderShare: completingOrders > 0 ? freeOrders / completingOrders : 0,
    recoveryRate: carrierSpend > 0 ? shippingRevenue / carrierSpend : 0,
  };
}
