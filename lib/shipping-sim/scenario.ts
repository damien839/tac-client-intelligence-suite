import { revealedPremium } from "./model";
import { cheapestTier, tierCost } from "./tiers";
import {
  BehavioralResult,
  BehaviorParams,
  CANONICAL_TIERS,
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

/**
 * The tier the recommendation sweeps target: the used tier with the most PAID
 * orders under the current scheme (most orders with a positive current fee).
 * Tie or all-free falls back to most total volume, then canonical tier order.
 * Returns null when there are no analysable orders.
 */
export function dominantPaidTier(orders: TaggedOrder[], current: Scheme): CanonicalTier | null {
  const valid = orders.filter((o) => current[o.tier] !== undefined);
  if (valid.length === 0) return null;

  const paid: Partial<Record<CanonicalTier, number>> = {};
  const total: Partial<Record<CanonicalTier, number>> = {};
  for (const o of valid) {
    const tierConfig = current[o.tier]!;
    total[o.tier] = (total[o.tier] ?? 0) + 1;
    if (tierCost(tierConfig, o.gross) > 0) {
      paid[o.tier] = (paid[o.tier] ?? 0) + 1;
    }
  }

  let best: CanonicalTier | null = null;
  let bestPaid = -1;
  let bestTotal = -1;
  for (const tier of CANONICAL_TIERS) {
    const p = paid[tier] ?? 0;
    const t = total[tier] ?? 0;
    if (t === 0) continue;
    if (
      p > bestPaid ||
      (p === bestPaid && t > bestTotal)
      // canonical order: CANONICAL_TIERS is iterated in order, strict > keeps earliest
    ) {
      best = tier;
      bestPaid = p;
      bestTotal = t;
    }
  }
  return best;
}

/** A bucket enriched with candidate-independent facts about the current scheme. */
export interface PreparedBucket extends OrderBucket {
  currentFee: number; // shipping the bucket pays under the current scheme
  premium: number; // revealed WTP premium under the current scheme
  currentThreshold: number | null; // free-over threshold of the bucket's current-scheme tier
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
      currentThreshold: current[bucket.tier]!.freeThreshold,
    };
  });
}

/**
 * Expected-value outcome of one candidate scheme. Per bucket:
 * 1. Land via revealed-WTP (same rule as landedTier, using the cached premium).
 * 2. Basket-building: in-window paying orders build to the threshold with
 *    weight upliftRate — ship free, carrier cost unchanged, gain product margin.
 *    Revealed-preference guard: uplift only applies where the candidate creates a
 *    NEW basket-building incentive. If the order was already within `upliftWindow`
 *    of the current scheme's threshold and was still paying, the data shows it
 *    didn't build — so it's excluded from uplift for the candidate too.
 * 3. Abandonment: of the remaining weight, worse-off orders (landed fee above
 *    current fee) abandon with probability `min(1, abandonRate × (increase / 10))` —
 *    where `abandonRate` is the share abandoning per $10 of shipping-cost increase.
 *    Lose product margin on the abandoning weight.
 * 4. The rest pay the landed fee.
 *
 * impact counts — EV-weighted, scaled by bucket.count:
 * - builders: basket-building weight (separate mechanism from newlyFree)
 * - switchedTier: completing weight landing on a different tier than the bucket's chosen tier
 * - newlyPaying: completing payers whose landed fee > 0 and current fee was 0
 * - newlyFree: completing payers whose landed fee === 0 and current fee was > 0
 *   (builders are NOT included — each count captures its own mechanism)
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
  let impactNewlyPaying = 0;
  let impactNewlyFree = 0;
  let impactBuilders = 0;
  let impactSwitchedTier = 0;
  const volumeByTier: Record<CanonicalTier, number> = { standard: 0, express: 0, nextday: 0, sameday: 0 };
  const carrierSpendByTier: Record<CanonicalTier, number> = { standard: 0, express: 0, nextday: 0, sameday: 0 };

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
    // Already had this incentive under the current scheme and demonstrably didn't build.
    const alreadyInWindow =
      bucket.currentThreshold !== null &&
      bucket.currentFee > 0 &&
      bucket.gross >= bucket.currentThreshold - upliftWindow;
    const inWindow =
      threshold !== null && landedFee > 0 && bucket.gross >= threshold - upliftWindow;
    const buildWeight = inWindow && !alreadyInWindow ? upliftRate : 0;
    const increase = landedFee - bucket.currentFee;
    const abandonProb = increase > 0 ? Math.min(1, abandonRate * (increase / 10)) : 0;
    const abandonWeight = (1 - buildWeight) * abandonProb;
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

    // Per-tier volume and carrier spend (completing orders only)
    volumeByTier[landed] += (buildWeight + payWeight) * bucket.count;
    carrierSpendByTier[landed] += (buildWeight + payWeight) * landedConfig.avgCost * bucket.count;

    // Impact counts (EV-weighted, completing payers only for newlyPaying/newlyFree)
    impactBuilders += buildWeight * bucket.count;
    if (landed !== bucket.tier) {
      impactSwitchedTier += (buildWeight + payWeight) * bucket.count;
    }
    if (landedFee > 0 && bucket.currentFee === 0) {
      impactNewlyPaying += payWeight * bucket.count;
    }
    if (landedFee === 0 && bucket.currentFee > 0) {
      impactNewlyFree += payWeight * bucket.count;
    }
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
    volumeByTier,
    carrierSpendByTier,
    impact: {
      newlyPaying: impactNewlyPaying,
      newlyFree: impactNewlyFree,
      builders: impactBuilders,
      switchedTier: impactSwitchedTier,
    },
  };
}

export function baselineNetOf(prepared: PreparedBucket[], current: Scheme): number {
  return prepared.reduce(
    (sum, b) => sum + (b.currentFee - current[b.tier]!.avgCost) * b.count,
    0
  );
}

const THRESHOLD_STEP = 10;
const THRESHOLD_FLOOR = 400; // always sweep at least this far
const THRESHOLD_CAP = 1000;
export const FEE_STEP = 1;
export const FEE_FLOOR = 30; // fee sweep upper bound: max(2x current fee, this)

/**
 * Candidate thresholds: $0..max($400, p95 of gross rounded up to $10), capped
 * at $1000, in $10 steps — plus null (flat, no free shipping) evaluated last so
 * ties prefer the lowest qualifying threshold.
 */
export function thresholdCandidates(orders: TaggedOrder[]): (number | null)[] {
  const sorted = orders.map((order) => order.gross).sort((a, b) => a - b);
  const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))] ?? 0;
  const maxThreshold = Math.min(
    THRESHOLD_CAP,
    Math.max(THRESHOLD_FLOOR, Math.ceil(p95 / THRESHOLD_STEP) * THRESHOLD_STEP)
  );
  const candidates: (number | null)[] = [];
  for (let t = 0; t <= maxThreshold; t += THRESHOLD_STEP) candidates.push(t);
  candidates.push(null);
  return candidates;
}
