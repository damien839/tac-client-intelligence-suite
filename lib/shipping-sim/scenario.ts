import { revealedPremium } from "./model";
import { cheapestTier, tierCost } from "./tiers";
import {
  CANONICAL_TIERS,
  CanonicalTier,
  MechanicalResult,
  OrderBucket,
  Scheme,
  TaggedOrder,
} from "./types";

/**
 * Group orders that are treated identically by the model, keyed on the EXACT
 * (tier, gross) pair.
 *
 * Bucketing must never round: gross is compared against free-shipping thresholds,
 * so a rounded $249.60 becomes $250 and silently ships free. That made a scheme's
 * fee revenue depend on how many distinct order values happened to be in the
 * upload, and made per-segment totals disagree with the whole-book figure.
 * Exact grouping is affordable — the grid runs a handful of O(buckets) passes.
 */
export function bucketOrders(orders: TaggedOrder[]): OrderBucket[] {
  const map = new Map<string, OrderBucket>();
  for (const order of orders) {
    const key = `${order.tier}|${order.gross}`;
    const existing = map.get(key);
    map.set(
      key,
      existing
        ? { ...existing, count: existing.count + 1 }
        : { tier: order.tier, gross: order.gross, count: 1 }
    );
  }
  return Array.from(map.values());
}

/**
 * The tier the candidate grid targets: the used tier carrying the most orders.
 *
 * Volume first, paid count only as a tie-break. Ranking by paid count instead
 * would send the grid at a small paid tier (10 paid Express orders) and never
 * explore the free line on the tier that actually carries the book (80 free
 * Standard orders) — the one lever worth comparing.
 * Returns null when there are no analysable orders.
 */
export function dominantTier(orders: TaggedOrder[], current: Scheme): CanonicalTier | null {
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
  let bestTotal = -1;
  let bestPaid = -1;
  for (const tier of CANONICAL_TIERS) {
    const t = total[tier] ?? 0;
    const p = paid[tier] ?? 0;
    if (t === 0) continue;
    if (
      t > bestTotal ||
      (t === bestTotal && p > bestPaid)
      // canonical order: CANONICAL_TIERS is iterated in order, strict > keeps earliest
    ) {
      best = tier;
      bestTotal = t;
      bestPaid = p;
    }
  }
  return best;
}

/** A bucket enriched with candidate-independent facts about the current scheme. */
export interface PreparedBucket extends OrderBucket {
  currentFee: number; // shipping the bucket pays under the current scheme
  premium: number; // revealed WTP premium under the current scheme
}

/**
 * Precompute the candidate-independent half of the model once per run; evaluations
 * then only compute the candidate-dependent half per bucket.
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

function emptyByTier(): Record<CanonicalTier, number> {
  return { standard: 0, express: 0, nextday: 0, sameday: 0 };
}

/**
 * Mechanical outcome of one candidate scheme. Per bucket:
 * 1. Land the order via revealed preference (the same rule as `landedTier`, using
 *    the cached premium): it keeps the tier the customer chose unless the candidate
 *    prices that tier above the premium they demonstrably paid, in which case it
 *    drops to the cheapest tier the candidate offers.
 * 2. It pays the landed tier's fee and incurs the landed tier's carrier cost.
 *
 * Nothing else moves: the same orders, at the same cart values, in the same volume.
 * Customer behaviour is explicitly NOT modelled — see the report's caveat line.
 */
export function mechanicalScenario(
  buckets: PreparedBucket[],
  candidate: Scheme
): MechanicalResult {
  let shippingRevenue = 0;
  let carrierSpend = 0;
  let freeOrders = 0;
  let orderCount = 0;
  let newlyPaying = 0;
  let newlyFree = 0;
  let switchedTier = 0;
  const volumeByTier = emptyByTier();
  const carrierSpendByTier = emptyByTier();

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

    shippingRevenue += landedFee * bucket.count;
    carrierSpend += landedConfig.avgCost * bucket.count;
    orderCount += bucket.count;
    if (landedFee === 0) freeOrders += bucket.count;

    volumeByTier[landed] += bucket.count;
    carrierSpendByTier[landed] += landedConfig.avgCost * bucket.count;

    if (landed !== bucket.tier) switchedTier += bucket.count;
    if (landedFee > 0 && bucket.currentFee === 0) newlyPaying += bucket.count;
    if (landedFee === 0 && bucket.currentFee > 0) newlyFree += bucket.count;
  }

  return {
    shippingRevenue,
    carrierSpend,
    netShippingProfit: shippingRevenue - carrierSpend,
    orderCount,
    freeOrderShare: orderCount > 0 ? freeOrders / orderCount : 0,
    recoveryRate: carrierSpend > 0 ? shippingRevenue / carrierSpend : 0,
    volumeByTier,
    carrierSpendByTier,
    impact: { newlyPaying, newlyFree, switchedTier },
  };
}

const THRESHOLD_STEP = 10;
const THRESHOLD_FLOOR = 400; // always sweep at least this far
const THRESHOLD_CAP = 1000;

/**
 * Sensitivity-curve thresholds: $0..max($400, p95 of gross rounded up to $10),
 * capped at $1000, in $10 steps. Drives the threshold sensitivity chart only —
 * the comparison grid uses the coarser percentile candidates in `candidates.ts`.
 */
export function thresholdCandidates(orders: TaggedOrder[]): number[] {
  const sorted = orders.map((order) => order.gross).sort((a, b) => a - b);
  const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))] ?? 0;
  const maxThreshold = Math.min(
    THRESHOLD_CAP,
    Math.max(THRESHOLD_FLOOR, Math.ceil(p95 / THRESHOLD_STEP) * THRESHOLD_STEP)
  );
  const candidates: number[] = [];
  for (let t = 0; t <= maxThreshold; t += THRESHOLD_STEP) candidates.push(t);
  return candidates;
}
