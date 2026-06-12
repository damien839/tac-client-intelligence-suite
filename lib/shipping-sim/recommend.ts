import { unitDrivenThresholds, valueClusters, ValueCluster } from "./units";
import {
  baselineNetOf,
  behavioralScenario,
  bucketOrders,
  dominantPaidTier,
  FEE_FLOOR,
  FEE_STEP,
  prepareBuckets,
  PreparedBucket,
  thresholdCandidates,
} from "./scenario";
import {
  BehavioralResult,
  BehaviorParams,
  CANONICAL_TIERS,
  CanonicalTier,
  RecommendedScheme,
  Scheme,
  SchemeEvaluation,
  TaggedOrder,
  ThresholdCurvePoint,
  UnitStats,
} from "./types";

// Re-export the scenario core so existing imports (tests, UI) keep working.
export { behavioralScenario, bucketOrders, dominantPaidTier, prepareBuckets, thresholdCandidates };
export type { PreparedBucket };

const COARSE_THRESHOLD_STEP = 20;
const COARSE_FEE_STEP = 2;
const FINE_THRESHOLD_STEP = 10;
const FINE_FEE_STEP = 1;
/** Above this many prepared buckets the coarse steps double (same spirit as the bucket cap). */
const COARSE_DOUBLE_BUCKETS = 1500;

/** Shared inputs for one recommendation run. */
interface SweepContext {
  prepared: PreparedBucket[];
  current: Scheme;
  baselineNet: number;
}

/** The raw outcome of one sweep — recommendOptions wraps it into a RecommendedScheme. */
interface SweepWinner {
  scheme: Scheme;
  result: BehavioralResult;
  contributionDelta: number;
  unconstrained: boolean;
  capPinned: boolean;
  basketNarrative?: string;
}

function contributionOf(
  ctx: SweepContext,
  candidate: Scheme,
  params: BehaviorParams
): { result: BehavioralResult; contributionDelta: number } {
  const result = behavioralScenario(ctx.prepared, candidate, params);
  return {
    result,
    contributionDelta:
      result.netShippingProfit - ctx.baselineNet + result.upliftMarginGain - result.abandonMarginLoss,
  };
}

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

/**
 * Ascending numeric threshold lever values on the coarse grid, with the current
 * threshold always included (so "keep current" stays representable even when it
 * is not a grid multiple) and null (flat, no free shipping) last.
 */
function thresholdLever(
  numeric: number[],
  currentThreshold: number | null,
  step: number
): (number | null)[] {
  const set = new Set<number>(numeric.filter((t) => t % step === 0));
  if (currentThreshold !== null) set.add(currentThreshold);
  const values: (number | null)[] = Array.from(set).sort((a, b) => a - b);
  values.push(null);
  return values;
}

/** Ascending fee lever values $0..max(2x current, $30), current fee always included. */
function feeLever(currentFee: number, step: number): { values: number[]; maxFee: number } {
  const maxFee = Math.ceil(Math.max(2 * currentFee, FEE_FLOOR));
  const set = new Set<number>([currentFee]);
  for (let fee = 0; fee <= maxFee; fee += step) set.add(fee);
  return { values: Array.from(set).sort((a, b) => a - b), maxFee };
}

/**
 * Threshold candidates for the express-like tier: the current value, flat (null),
 * plus the unit-driven candidates when line-item data exists — a free-express line
 * only makes sense at a value that drives another unit.
 */
function expressThresholdLever(
  currentThreshold: number | null,
  valid: TaggedOrder[],
  unitStats: UnitStats | null
): (number | null)[] {
  const out: (number | null)[] = [];
  const seen = new Set<string>();
  const push = (t: number | null) => {
    const key = t === null ? "null" : String(t);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  };
  push(currentThreshold);
  push(null);
  if (unitStats) {
    const candidates = unitDrivenThresholds(
      valueClusters(valid.map((order) => order.gross)),
      unitStats.typicalUnitPrice
    );
    for (const t of candidates) push(t);
  }
  return out;
}

/**
 * The lever pair for the multi-tier net-profit sweep. The "standard-like" tier gets
 * the full threshold sweep; the "express-like" partner gets the fee sweep plus the
 * unit-driven threshold candidates. Standard is standard-like when used; otherwise
 * the first used tier in canonical order. The partner is the dominant PAID tier
 * among the rest (most paid orders, tie -> most volume, tie -> canonical order).
 */
function sweepTierPair(
  usedTiers: CanonicalTier[],
  prepared: PreparedBucket[]
): { stdTier: CanonicalTier; expTier: CanonicalTier } {
  const stdTier = usedTiers.includes("standard") ? "standard" : usedTiers[0];
  const rest = usedTiers.filter((tier) => tier !== stdTier);
  let expTier = rest[0];
  let bestPaid = -1;
  let bestTotal = -1;
  for (const tier of rest) {
    let paid = 0;
    let total = 0;
    for (const bucket of prepared) {
      if (bucket.tier !== tier) continue;
      total += bucket.count;
      if (bucket.currentFee > 0) paid += bucket.count;
    }
    if (paid > bestPaid || (paid === bestPaid && total > bestTotal)) {
      expTier = tier;
      bestPaid = paid;
      bestTotal = total;
    }
  }
  return { stdTier, expTier };
}

interface NetProfitCandidate {
  stdT: number | null;
  stdFee: number;
  expT: number | null;
  expFee: number;
}

/**
 * Multi-tier net-profit sweep: stdT x stdFee x expFee x expT, uplift forced off,
 * abandonment live. Coarse argmax then ONE refine pass (+-1 coarse step around the
 * numeric winners at $10/$1/$1).
 *
 * Budget: coarse = |stdT| x |stdFee| x |expFee| x |expT|. On a typical book (fees
 * ~$30/$60, p95 ~$600, no dense clusters) that is ~33 x 31 x 61 x 1 ~= 62k scheme
 * evaluations; the theoretical worst (threshold cap $1000, both fees high, 8 unit
 * candidates) is far larger, so above COARSE_DOUBLE_BUCKETS prepared buckets the
 * coarse steps double ($40/$4), quartering the numeric grid. The refine pass adds
 * at most 5 x 5 x 5 = 125 evaluations.
 */
function sweepNetProfitMultiTier(
  ctx: SweepContext,
  valid: TaggedOrder[],
  behavior: BehaviorParams,
  unitStats: UnitStats | null,
  stdTier: CanonicalTier,
  expTier: CanonicalTier
): SweepWinner {
  const { current } = ctx;
  const stdConfig = current[stdTier]!;
  const expConfig = current[expTier]!;
  const noUplift: BehaviorParams = { ...behavior, upliftRate: 0 };
  const doubled = ctx.prepared.length > COARSE_DOUBLE_BUCKETS;
  const thresholdStep = doubled ? COARSE_THRESHOLD_STEP * 2 : COARSE_THRESHOLD_STEP;
  const feeStep = doubled ? COARSE_FEE_STEP * 2 : COARSE_FEE_STEP;

  const numericThresholds = thresholdCandidates(valid).filter((t): t is number => t !== null);
  const maxThreshold = numericThresholds[numericThresholds.length - 1];
  const stdThresholds = thresholdLever(numericThresholds, stdConfig.freeThreshold, thresholdStep);
  const { values: stdFees, maxFee: maxStdFee } = feeLever(stdConfig.fee, feeStep);
  const { values: expFees, maxFee: maxExpFee } = feeLever(expConfig.fee, feeStep);
  const expThresholds = expressThresholdLever(expConfig.freeThreshold, valid, unitStats);

  const makeScheme = (c: NetProfitCandidate): Scheme => ({
    ...current,
    [stdTier]: { ...stdConfig, fee: c.stdFee, freeThreshold: c.stdT },
    [expTier]: { ...expConfig, fee: c.expFee, freeThreshold: c.expT },
  });

  let best:
    | { cand: NetProfitCandidate; scheme: Scheme; result: BehavioralResult; contributionDelta: number }
    | null = null;
  const consider = (cand: NetProfitCandidate) => {
    const scheme = makeScheme(cand);
    const { result, contributionDelta } = contributionOf(ctx, scheme, noUplift);
    if (!best || contributionDelta > best.contributionDelta) {
      best = { cand, scheme, result, contributionDelta };
    }
  };

  // Coarse pass. Ascending loops + strict > keep the earliest (lowest-lever) of ties.
  for (const expT of expThresholds) {
    for (const expFee of expFees) {
      for (const stdT of stdThresholds) {
        for (const stdFee of stdFees) {
          consider({ stdT, stdFee, expT, expFee });
        }
      }
    }
  }
  if (!best) throw new Error("net-profit sweep evaluated no candidates");
  const coarse: { cand: NetProfitCandidate } = best;

  // Refine pass: +-1 coarse step around each numeric winner at fine steps. The expT
  // lever is a discrete data-driven set, not a range — it stays at its winner.
  const refineRange = (center: number, coarseStep: number, fineStep: number, max: number): number[] => {
    const values = new Set<number>([center]);
    for (let v = center - coarseStep; v <= center + coarseStep; v += fineStep) {
      if (v >= 0 && v <= max) values.add(v);
    }
    return Array.from(values).sort((a, b) => a - b);
  };
  const fineStdThresholds: (number | null)[] =
    coarse.cand.stdT === null
      ? [null]
      : refineRange(coarse.cand.stdT, thresholdStep, FINE_THRESHOLD_STEP, maxThreshold);
  const fineStdFees = refineRange(coarse.cand.stdFee, feeStep, FINE_FEE_STEP, maxStdFee);
  const fineExpFees = refineRange(coarse.cand.expFee, feeStep, FINE_FEE_STEP, maxExpFee);
  for (const stdT of fineStdThresholds) {
    for (const stdFee of fineStdFees) {
      for (const expFee of fineExpFees) {
        consider({ stdT, stdFee, expT: coarse.cand.expT, expFee });
      }
    }
  }

  const winner: { cand: NetProfitCandidate; scheme: Scheme; result: BehavioralResult; contributionDelta: number } =
    best;
  const unconstrained =
    behavior.abandonRate === 0 &&
    (winner.cand.stdT === null ||
      winner.cand.stdT === maxThreshold ||
      winner.result.freeOrderShare === 0 ||
      winner.cand.stdFee === maxStdFee ||
      winner.cand.expFee === maxExpFee);
  const capPinned =
    winner.cand.stdT === maxThreshold ||
    winner.cand.stdFee === maxStdFee ||
    winner.cand.expFee === maxExpFee;
  return {
    scheme: winner.scheme,
    result: winner.result,
    contributionDelta: winner.contributionDelta,
    unconstrained,
    capPinned,
  };
}

/**
 * Single-used-tier degradation of the net-profit sweep: the old full-resolution 2D
 * threshold x fee grid on that tier ($10 / $1 steps), uplift forced off, abandonment
 * live. Fee-major iteration + strict > keep ties at the lowest fee, then threshold.
 */
function sweepNetProfitSingleTier(
  ctx: SweepContext,
  valid: TaggedOrder[],
  behavior: BehaviorParams,
  tier: CanonicalTier
): SweepWinner {
  const target = ctx.current[tier]!;
  const noUplift: BehaviorParams = { ...behavior, upliftRate: 0 };
  const thresholds = thresholdCandidates(valid);
  // null is always last; the numeric cap is the second-to-last entry.
  const maxThreshold = thresholds[thresholds.length - 2] as number;
  const maxFee = Math.ceil(Math.max(2 * target.fee, FEE_FLOOR));

  let best:
    | { threshold: number | null; fee: number; scheme: Scheme; result: BehavioralResult; contributionDelta: number }
    | null = null;
  for (let fee = 0; fee <= maxFee; fee += FEE_STEP) {
    for (const threshold of thresholds) {
      const scheme: Scheme = { ...ctx.current, [tier]: { ...target, fee, freeThreshold: threshold } };
      const { result, contributionDelta } = contributionOf(ctx, scheme, noUplift);
      if (!best || contributionDelta > best.contributionDelta) {
        best = { threshold, fee, scheme, result, contributionDelta };
      }
    }
  }
  if (!best) throw new Error("net-profit sweep evaluated no candidates");
  const winner: NonNullable<typeof best> = best;

  // Degeneracy guard: with abandonment off nothing punishes charging more — flag
  // charges-everyone, flat, and range-edge optima. Cap-pinned: the optimum sits at
  // the sweep edge, so the true best may lie beyond (null is a complete answer).
  const unconstrained =
    behavior.abandonRate === 0 &&
    (winner.threshold === null ||
      winner.threshold === maxThreshold ||
      winner.result.freeOrderShare === 0 ||
      winner.fee === maxFee);
  const capPinned = winner.threshold === maxThreshold || winner.fee === maxFee;
  return {
    scheme: winner.scheme,
    result: winner.result,
    contributionDelta: winner.contributionDelta,
    unconstrained,
    capPinned,
  };
}

/**
 * Unit-driven basket-builder sweep: thresholds derived from dense order-value
 * clusters plus one typical unit, applied as single-tier threshold changes to each
 * used tier (fees unchanged) plus the best-per-tier combination. Uplift ON with the
 * window OVERRIDDEN to the typical unit price; abandonment live. When no candidate
 * beats keeping the current scheme, the winner IS the current scheme (no narrative).
 */
function sweepBasketUnitDriven(
  ctx: SweepContext,
  valid: TaggedOrder[],
  behavior: BehaviorParams,
  unitStats: UnitStats,
  usedTiers: CanonicalTier[]
): SweepWinner {
  const { current } = ctx;
  const unitWindow = unitStats.typicalUnitPrice;
  const params: BehaviorParams = { ...behavior, upliftWindow: unitWindow };
  const clusters = valueClusters(valid.map((order) => order.gross));
  const candidates = unitDrivenThresholds(clusters, unitWindow);

  // Candidate threshold -> densest source cluster (clusters arrive count-desc).
  const sourceCluster = new Map<number, ValueCluster>();
  for (const cluster of clusters) {
    const t = Math.ceil((cluster.hi + unitWindow) / 5) * 5;
    if (!sourceCluster.has(t)) sourceCluster.set(t, cluster);
  }

  let best:
    | { scheme: Scheme; result: BehavioralResult; contributionDelta: number; threshold: number }
    | null = null;
  const perTier = new Map<CanonicalTier, { threshold: number; contributionDelta: number }>();
  for (const tier of usedTiers) {
    for (const threshold of candidates) {
      const scheme: Scheme = { ...current, [tier]: { ...current[tier]!, freeThreshold: threshold } };
      const { result, contributionDelta } = contributionOf(ctx, scheme, params);
      if (!best || contributionDelta > best.contributionDelta) {
        best = { scheme, result, contributionDelta, threshold };
      }
      const prev = perTier.get(tier);
      if (!prev || contributionDelta > prev.contributionDelta) {
        perTier.set(tier, { threshold, contributionDelta });
      }
    }
  }

  // Best-per-tier combination: each profitably-changed tier's winning threshold at
  // once (a tier whose best single change loses money can never improve the combo).
  const profitableTiers = usedTiers.filter(
    (tier) => (perTier.get(tier)?.contributionDelta ?? 0) > 0
  );
  if (profitableTiers.length >= 2) {
    const scheme = profitableTiers.reduce<Scheme>(
      (acc, tier) => ({ ...acc, [tier]: { ...current[tier]!, freeThreshold: perTier.get(tier)!.threshold } }),
      { ...current }
    );
    const { result, contributionDelta } = contributionOf(ctx, scheme, params);
    if (best && contributionDelta > best.contributionDelta) {
      // Narrative anchors on the tier whose single change contributed most.
      const primary = profitableTiers.reduce((a, b) =>
        perTier.get(b)!.contributionDelta > perTier.get(a)!.contributionDelta ? b : a
      );
      best = { scheme, result, contributionDelta, threshold: perTier.get(primary)!.threshold };
    }
  }

  if (!best || best.contributionDelta <= 0) {
    // Keep current: nothing in the unit-driven candidate set beats today's scheme.
    // Evaluating current-vs-current is a strict no-op, so deltas are exactly zero.
    const { result, contributionDelta } = contributionOf(ctx, { ...current }, params);
    return {
      scheme: { ...current },
      result,
      contributionDelta,
      unconstrained: false,
      capPinned: false,
    };
  }

  const winner: NonNullable<typeof best> = best;
  const cluster = sourceCluster.get(winner.threshold);
  const basketNarrative = cluster
    ? `Free over $${winner.threshold} — your $${cluster.lo}–$${cluster.hi} orders add one ~$${Math.round(unitWindow)} unit to qualify.`
    : undefined;
  // The candidate set is data-driven and discrete, not a swept range — there is no
  // range edge to pin against, so capPinned stays false. The abandonment-off guard
  // keeps its charges-everyone arm.
  const unconstrained = behavior.abandonRate === 0 && winner.result.freeOrderShare === 0;
  return {
    scheme: winner.scheme,
    result: winner.result,
    contributionDelta: winner.contributionDelta,
    unconstrained,
    capPinned: false,
    basketNarrative,
  };
}

/**
 * Slider-window basket-builder fallback (no line-item data): the previous threshold
 * sweep on the dominant paid tier — fee fixed at current, uplift on with the
 * caller's window, abandonment live.
 */
function sweepBasketFallback(
  ctx: SweepContext,
  valid: TaggedOrder[],
  behavior: BehaviorParams,
  tier: CanonicalTier
): SweepWinner {
  const target = ctx.current[tier]!;
  const thresholds = thresholdCandidates(valid);
  const maxThreshold = thresholds[thresholds.length - 2] as number;

  let best:
    | { threshold: number | null; scheme: Scheme; result: BehavioralResult; contributionDelta: number }
    | null = null;
  for (const threshold of thresholds) {
    const scheme: Scheme = { ...ctx.current, [tier]: { ...target, freeThreshold: threshold } };
    const { result, contributionDelta } = contributionOf(ctx, scheme, behavior);
    if (!best || contributionDelta > best.contributionDelta) {
      best = { threshold, scheme, result, contributionDelta };
    }
  }
  if (!best) throw new Error("basket sweep evaluated no candidates");
  const winner: NonNullable<typeof best> = best;

  const unconstrained =
    behavior.abandonRate === 0 &&
    (winner.threshold === null ||
      winner.threshold === maxThreshold ||
      winner.result.freeOrderShare === 0);
  const capPinned = winner.threshold === maxThreshold;
  return {
    scheme: winner.scheme,
    result: winner.result,
    contributionDelta: winner.contributionDelta,
    unconstrained,
    capPinned,
  };
}

/**
 * Run the two v4 recommendation sweeps.
 * - net-profit: bounded multi-tier sweep (std threshold x std fee x exp fee x exp
 *   threshold from unit-driven candidates), uplift forced off; single-used-tier
 *   data degrades to the old 2D sweep on that tier.
 * - basket-builder: unit-driven thresholds (clusters + one typical unit, window
 *   overridden to the typical unit price) when unitStats is present; otherwise the
 *   previous slider-window sweep on the dominant paid tier.
 * Abandonment applies to both. Objective: expected total contribution delta vs the
 * current scheme (shipping P&L + product-margin effects).
 */
export function recommendOptions(
  orders: TaggedOrder[],
  current: Scheme,
  behavior: BehaviorParams,
  unitStats: UnitStats | null
): RecommendedScheme[] {
  const dominant = dominantPaidTier(orders, current);
  if (!dominant) return [];
  const valid = orders.filter((order) => current[order.tier] !== undefined);
  // dominantPaidTier already returns null when valid.length === 0, so this is unreachable,
  // but guard against future drift between the two filters.
  if (valid.length === 0) return [];

  const prepared = prepareBuckets(bucketOrders(valid), current);
  const ctx: SweepContext = { prepared, current, baselineNet: baselineNetOf(prepared, current) };
  const usedTiers = CANONICAL_TIERS.filter(
    (tier) => current[tier] !== undefined && prepared.some((bucket) => bucket.tier === tier)
  );

  let netProfit: SweepWinner;
  if (usedTiers.length >= 2) {
    const { stdTier, expTier } = sweepTierPair(usedTiers, prepared);
    netProfit = sweepNetProfitMultiTier(ctx, valid, behavior, unitStats, stdTier, expTier);
  } else {
    netProfit = sweepNetProfitSingleTier(ctx, valid, behavior, usedTiers[0]);
  }

  const basket = unitStats
    ? sweepBasketUnitDriven(ctx, valid, behavior, unitStats, usedTiers)
    : sweepBasketFallback(ctx, valid, behavior, dominant);

  const toRecommended = (
    id: RecommendedScheme["id"],
    label: string,
    w: SweepWinner
  ): RecommendedScheme => ({
    id,
    label,
    scheme: w.scheme,
    changedTiers: changedTiersOf(current, w.scheme),
    contributionDelta: w.contributionDelta,
    netShippingProfitDelta: w.result.netShippingProfit - ctx.baselineNet,
    upliftMarginGain: w.result.upliftMarginGain,
    abandonMarginLoss: w.result.abandonMarginLoss,
    expectedOrdersLost: w.result.expectedOrdersLost,
    freeOrderShare: w.result.freeOrderShare,
    recoveryRate: w.result.recoveryRate,
    unconstrained: w.unconstrained,
    capPinned: w.capPinned,
    ...(w.basketNarrative !== undefined ? { basketNarrative: w.basketNarrative } : {}),
  });

  return [
    toRecommended("net-profit", "Net profit maximiser", netProfit),
    toRecommended("basket-builder", "Basket-builder", basket),
  ];
}

/**
 * Evaluate one candidate scheme under the behavioural model — the same metrics
 * recommendOptions reports for its winners, for any caller-supplied scheme.
 */
export function evaluateScheme(
  orders: TaggedOrder[],
  current: Scheme,
  candidate: Scheme,
  behavior: BehaviorParams
): SchemeEvaluation | null {
  const valid = orders.filter((order) => current[order.tier] !== undefined);
  if (valid.length === 0) return null;
  const prepared = prepareBuckets(bucketOrders(valid), current);
  const baselineNet = baselineNetOf(prepared, current);
  const result = behavioralScenario(prepared, candidate, behavior);
  return {
    contributionDelta:
      result.netShippingProfit - baselineNet + result.upliftMarginGain - result.abandonMarginLoss,
    netShippingProfitDelta: result.netShippingProfit - baselineNet,
    shippingRevenue: result.shippingRevenue,
    carrierSpend: result.carrierSpend,
    netShippingProfit: result.netShippingProfit,
    upliftMarginGain: result.upliftMarginGain,
    abandonMarginLoss: result.abandonMarginLoss,
    expectedOrdersLost: result.expectedOrdersLost,
    freeOrderShare: result.freeOrderShare,
    recoveryRate: result.recoveryRate,
    orderCount: valid.length,
    volumeByTier: result.volumeByTier,
    carrierSpendByTier: result.carrierSpendByTier,
    impact: result.impact,
  };
}

/**
 * Contribution-vs-threshold curves for the sensitivity chart: the dominant paid
 * tier's free-over threshold sweeps the numeric candidates (fee held at current),
 * evaluated with basket-building off and on. Abandonment per the caller.
 */
export function thresholdCurves(
  orders: TaggedOrder[],
  current: Scheme,
  behavior: BehaviorParams
): ThresholdCurvePoint[] {
  const tier = dominantPaidTier(orders, current);
  if (!tier) return [];
  const target = current[tier]!;
  const valid = orders.filter((order) => current[order.tier] !== undefined);
  if (valid.length === 0) return [];
  const prepared = prepareBuckets(bucketOrders(valid), current);
  const baselineNet = baselineNetOf(prepared, current);
  const noUplift: BehaviorParams = { ...behavior, upliftRate: 0 };
  const contribution = (candidate: Scheme, params: BehaviorParams): number => {
    const r = behavioralScenario(prepared, candidate, params);
    return r.netShippingProfit - baselineNet + r.upliftMarginGain - r.abandonMarginLoss;
  };
  return thresholdCandidates(valid)
    .filter((t): t is number => t !== null)
    .map((threshold) => {
      const candidate: Scheme = { ...current, [tier]: { ...target, freeThreshold: threshold } };
      return {
        threshold,
        contributionNoUplift: contribution(candidate, noUplift),
        contributionWithUplift: contribution(candidate, behavior),
      };
    });
}
