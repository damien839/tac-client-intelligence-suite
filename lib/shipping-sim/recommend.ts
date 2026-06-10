import { revealedPremium } from "./model";
import { cheapestTier, tierCost } from "./tiers";
import {
  BehavioralResult,
  BehaviorParams,
  CanonicalTier,
  OrderBucket,
  RecommendationId,
  RecommendedScheme,
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

const THRESHOLD_STEP = 10;
const THRESHOLD_FLOOR = 400; // always sweep at least this far
const THRESHOLD_CAP = 1000;
const FEE_STEP = 1;
const FEE_FLOOR = 30; // fee sweep upper bound: max(2x current fee, this)

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

interface CandidateResult {
  threshold: number | null;
  fee: number;
  result: BehavioralResult;
  contributionDelta: number;
}

/**
 * Run the three recommendation sweeps over the standard tier.
 * - profit-first: threshold only, uplift forced off
 * - threshold-fee: threshold x fee grid, uplift forced off
 * - basket-builder: threshold only, uplift per the caller's params
 * Abandonment applies to all three. Objective: expected total contribution
 * delta vs the current scheme (shipping P&L + product-margin effects).
 */
export function recommendOptions(
  orders: TaggedOrder[],
  current: Scheme,
  behavior: BehaviorParams
): RecommendedScheme[] {
  const std = current.standard;
  if (!std) return [];
  const valid = orders.filter((order) => current[order.tier] !== undefined);
  if (valid.length === 0) return [];

  const prepared = prepareBuckets(bucketOrders(valid), current);
  const baselineNet = prepared.reduce(
    (sum, b) => sum + (b.currentFee - current[b.tier]!.avgCost) * b.count,
    0
  );
  const thresholds = thresholdCandidates(valid);
  const maxFee = Math.max(2 * std.fee, FEE_FLOOR);
  const noUplift: BehaviorParams = { ...behavior, upliftRate: 0 };

  const evalCandidate = (
    threshold: number | null,
    fee: number,
    params: BehaviorParams
  ): CandidateResult => {
    const candidate: Scheme = { ...current, standard: { ...std, fee, freeThreshold: threshold } };
    const result = behavioralScenario(prepared, candidate, params);
    return {
      threshold,
      fee,
      result,
      contributionDelta:
        result.netShippingProfit - baselineNet + result.upliftMarginGain - result.abandonMarginLoss,
    };
  };

  // Strict > keeps the earliest of tied candidates: lowest threshold, lowest fee.
  const best = (candidates: CandidateResult[]): CandidateResult =>
    candidates.reduce((acc, c) => (c.contributionDelta > acc.contributionDelta ? c : acc));

  const bestA = best(thresholds.map((t) => evalCandidate(t, std.fee, noUplift)));
  const grid: CandidateResult[] = [];
  for (let fee = 0; fee <= maxFee; fee += FEE_STEP) {
    for (const t of thresholds) grid.push(evalCandidate(t, fee, noUplift));
  }
  const bestB = best(grid);
  const bestC = best(thresholds.map((t) => evalCandidate(t, std.fee, behavior)));

  // Degeneracy guard: with abandonment off, nothing in the model punishes charging
  // more. Flag optima that charge everyone (no free shipping granted) or pin the
  // fee at the top of its range.
  const isUnconstrained = (c: CandidateResult, sweepsFee: boolean): boolean =>
    behavior.abandonRate === 0 &&
    (c.threshold === null || c.result.freeOrderShare === 0 || (sweepsFee && c.fee === maxFee));

  const toScheme = (
    id: RecommendationId,
    label: string,
    c: CandidateResult,
    sweepsFee: boolean
  ): RecommendedScheme => ({
    id,
    label,
    threshold: c.threshold,
    fee: c.fee,
    contributionDelta: c.contributionDelta,
    netShippingProfitDelta: c.result.netShippingProfit - baselineNet,
    upliftMarginGain: c.result.upliftMarginGain,
    abandonMarginLoss: c.result.abandonMarginLoss,
    freeOrderShare: c.result.freeOrderShare,
    recoveryRate: c.result.recoveryRate,
    expectedOrdersLost: c.result.expectedOrdersLost,
    unconstrained: isUnconstrained(c, sweepsFee),
  });

  return [
    toScheme("profit-first", "Profit-first", bestA, false),
    toScheme("threshold-fee", "Optimised threshold + fee", bestB, true),
    toScheme("basket-builder", "Basket-builder", bestC, false),
  ];
}
