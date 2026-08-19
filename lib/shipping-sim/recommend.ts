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

/** v4.1 cost-neutral objective: |revenue - cost| within 2% of the candidate's carrier spend. */
const NEUTRAL_BAND = 0.02;
/** v4.1 materiality floor: sweep winners below this many $ collapse to keep-current. */
const MIN_MATERIAL_DELTA = 1;

function neutralDistance(result: BehavioralResult): number {
  return Math.abs(result.shippingRevenue - result.carrierSpend);
}

function isNeutral(result: BehavioralResult): boolean {
  return neutralDistance(result) <= NEUTRAL_BAND * result.carrierSpend;
}

/**
 * Cost-recovery comparator (v4.1, spec lexicographic objective): neutral candidates
 * beat non-neutral; among neutral, higher contribution wins (rewards freight shifting
 * and low abandonment); among non-neutral, smaller distance to neutral wins,
 * tie-broken by contribution. Strict better-than, so iteration order keeps the
 * existing tie preference (the earliest candidate considered wins ties).
 */
function betterForCostRecovery(
  a: { result: BehavioralResult; contributionDelta: number },
  b: { result: BehavioralResult; contributionDelta: number }
): boolean {
  const aNeutral = isNeutral(a.result);
  const bNeutral = isNeutral(b.result);
  if (aNeutral !== bNeutral) return aNeutral;
  if (aNeutral) return a.contributionDelta > b.contributionDelta;
  const dA = neutralDistance(a.result);
  const dB = neutralDistance(b.result);
  if (dA !== dB) return dA < dB;
  return a.contributionDelta > b.contributionDelta;
}

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
 * Multi-tier cost-recovery sweep: stdT x stdFee x expFee x expT, uplift forced off,
 * abandonment live, ranked by the v4.1 lexicographic comparator (neutral first, then
 * contribution / distance-to-neutral). Coarse pass, then refine passes (+-1 coarse
 * step around the numeric winners at $10/$1/$1).
 *
 * TWO refine seeds (as-built v4.1 amendment): the neutral set is a thin manifold in
 * fee space (often a single $1 fee value), so the coarse grid can miss the best
 * neutral basin entirely while containing a much worse neutral elsewhere — which
 * would then dominate the argmax and trap the single refine pass. The best
 * NON-neutral coarse candidate (smallest distance to neutral) brackets where the
 * manifold crosses between coarse grid points, so we refine around it as well.
 * The final winner is the comparator-best over every candidate considered.
 *
 * Budget: coarse = |stdT| x |stdFee| x |expFee| x |expT|. On a typical book (fees
 * ~$30/$60, p95 ~$600, no dense clusters) that is ~33 x 31 x 61 x 1 ~= 62k scheme
 * evaluations; the theoretical worst (threshold cap $1000, both fees high, 8 unit
 * candidates) is far larger, so above COARSE_DOUBLE_BUCKETS prepared buckets the
 * coarse steps double ($40/$4), quartering the numeric grid. Each refine pass adds
 * at most 5 x 5 x 5 = 125 evaluations at base steps (9 per lever -> up to 729 when
 * the coarse steps are doubled for large bucket counts); two seeds double that.
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

  interface Considered {
    cand: NetProfitCandidate;
    scheme: Scheme;
    result: BehavioralResult;
    contributionDelta: number;
  }
  // Mutable record (not closed-over lets) so reads after the loops keep the declared
  // nullable type — TS control-flow analysis can't see closure assignments.
  const tracked: { best: Considered | null; nonNeutral: Considered | null } = {
    best: null,
    nonNeutral: null,
  };
  const consider = (cand: NetProfitCandidate) => {
    const scheme = makeScheme(cand);
    const { result, contributionDelta } = contributionOf(ctx, scheme, noUplift);
    const entry: Considered = { cand, scheme, result, contributionDelta };
    if (!tracked.best || betterForCostRecovery(entry, tracked.best)) tracked.best = entry;
    if (
      !isNeutral(result) &&
      (!tracked.nonNeutral || betterForCostRecovery(entry, tracked.nonNeutral))
    ) {
      tracked.nonNeutral = entry;
    }
  };

  // Coarse pass. Strict better-than keeps the first of tied candidates: lowest value
  // for the ascending numeric levers; for the discrete express-threshold lever the
  // order is current -> null -> candidates, so ties prefer the current express line.
  for (const expT of expThresholds) {
    for (const expFee of expFees) {
      for (const stdT of stdThresholds) {
        for (const stdFee of stdFees) {
          consider({ stdT, stdFee, expT, expFee });
        }
      }
    }
  }
  const coarse = tracked.best;
  if (!coarse) throw new Error("net-profit sweep evaluated no candidates");
  const coarseNonNeutral = tracked.nonNeutral;

  // Refine passes: +-1 coarse step around each numeric winner at fine steps. The expT
  // lever is a discrete data-driven set, not a range — it stays at its seed's value.
  const refineRange = (center: number, coarseStep: number, fineStep: number, max: number): number[] => {
    const values = new Set<number>([center]);
    for (let v = center - coarseStep; v <= center + coarseStep; v += fineStep) {
      if (v >= 0 && v <= max) values.add(v);
    }
    return Array.from(values).sort((a, b) => a - b);
  };
  const refineAround = (seed: NetProfitCandidate) => {
    const fineStdThresholds: (number | null)[] =
      seed.stdT === null
        ? [null]
        : refineRange(seed.stdT, thresholdStep, FINE_THRESHOLD_STEP, maxThreshold);
    const fineStdFees = refineRange(seed.stdFee, feeStep, FINE_FEE_STEP, maxStdFee);
    const fineExpFees = refineRange(seed.expFee, feeStep, FINE_FEE_STEP, maxExpFee);
    for (const stdT of fineStdThresholds) {
      for (const stdFee of fineStdFees) {
        for (const expFee of fineExpFees) {
          consider({ stdT, stdFee, expT: seed.expT, expFee });
        }
      }
    }
  };
  refineAround(coarse.cand);
  // Second seed: the closest-to-neutral NON-neutral coarse candidate brackets the
  // thin neutral manifold the coarse grid may have stepped over (see doc above).
  if (coarseNonNeutral && coarseNonNeutral.cand !== coarse.cand) {
    refineAround(coarseNonNeutral.cand);
  }

  const winner: Considered = tracked.best ?? coarse;
  // v4.1: the charge-more degeneracy cannot survive the neutrality objective —
  // overshooting cost is penalised by distance even with abandonment at 0 — so the
  // old unconstrained guard arms (flat / top-of-range / charges-everyone optimum at
  // 0% abandonment) no longer mark unreliable optima. Always false for this option.
  const unconstrained = false;
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
 * Single-used-tier degradation of the cost-recovery sweep: the old full-resolution
 * 2D threshold x fee grid on that tier ($10 / $1 steps), uplift forced off,
 * abandonment live, ranked by the v4.1 lexicographic comparator. Full resolution
 * means the thin neutral manifold is always visible — no second seed needed here.
 * Fee-major iteration + strict better-than keep ties at the lowest fee, then the
 * lowest threshold.
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
      if (!best || betterForCostRecovery({ result, contributionDelta }, best)) {
        best = { threshold, fee, scheme, result, contributionDelta };
      }
    }
  }
  if (!best) throw new Error("net-profit sweep evaluated no candidates");
  const winner: NonNullable<typeof best> = best;

  // v4.1: unconstrained is always false for the cost-recovery option — the old guard
  // existed because with abandonment off nothing punished charging more; under the
  // neutrality objective overshoot is penalised by distance, so the charge-more
  // degeneracy (flat / top-of-range / charges-everyone optima) cannot win.
  // Cap-pinned is unchanged: the optimum sits at the sweep edge, so the true best
  // may lie beyond it (happens when even the fee cap cannot reach the neutral band).
  const unconstrained = false;
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

  // Best-per-tier combination, evaluated UNCONDITIONALLY when two or more tiers have
  // candidates: tier-switching makes the levers interact (moving one tier's free line
  // changes which tier is every order's cheapest alternative), so a tier whose best
  // single change loses money can still improve the combination.
  const comboTiers = usedTiers.filter((tier) => perTier.has(tier));
  if (comboTiers.length >= 2) {
    const scheme = comboTiers.reduce<Scheme>(
      (acc, tier) => ({ ...acc, [tier]: { ...current[tier]!, freeThreshold: perTier.get(tier)!.threshold } }),
      { ...current }
    );
    const { result, contributionDelta } = contributionOf(ctx, scheme, params);
    if (best && contributionDelta > best.contributionDelta) {
      // Narrative anchors on the tier whose single change contributed most.
      const primary = comboTiers.reduce((a, b) =>
        perTier.get(b)!.contributionDelta > perTier.get(a)!.contributionDelta ? b : a
      );
      best = { scheme, result, contributionDelta, threshold: perTier.get(primary)!.threshold };
    }
  }

  if (!best || best.contributionDelta < MIN_MATERIAL_DELTA) {
    // Keep current: nothing in the unit-driven candidate set beats today's scheme by
    // a MATERIAL margin (v4.1 floor — float-dust winners that display as +$0.00 must
    // not unseat the current scheme). Evaluating current-vs-current is a strict
    // no-op, so deltas are exactly zero.
    return keepCurrentWinner(ctx, params);
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
 * The "keep the current scheme" winner: evaluating current-vs-current with any
 * params is a strict no-op (guaranteed by the revealed-preference uplift guard and
 * the strict worse-off abandonment test), so every delta is exactly zero.
 */
function keepCurrentWinner(ctx: SweepContext, params: BehaviorParams): SweepWinner {
  const { result, contributionDelta } = contributionOf(ctx, { ...ctx.current }, params);
  return {
    scheme: { ...ctx.current },
    result,
    contributionDelta,
    unconstrained: false,
    capPinned: false,
  };
}

/**
 * v4.1 materiality floor, applied to each sweep's winner: collapse to keep-current
 * when the winner makes less than MIN_MATERIAL_DELTA ($1) of expected contribution.
 *
 * Cost-recovery interaction (`spareNeutralityGains`): closing a subsidy RAISES
 * contribution, so a genuine neutrality improvement is material unless the book is
 * already neutral — but correcting an OVERSHOOT (e.g. 149% recovery back to ~100%)
 * LOWERS revenue and shows a negative contribution on purpose. The floor therefore
 * spares any winner that moves |revenue - cost| strictly closer to zero than the
 * current scheme; it only collapses winners that neither make material money nor
 * get the book closer to neutral. The basket-builder's objective is unchanged
 * (pure contribution), so it uses the simple floor.
 */
function applyMaterialityFloor(
  ctx: SweepContext,
  winner: SweepWinner,
  params: BehaviorParams,
  spareNeutralityGains: boolean
): SweepWinner {
  if (winner.contributionDelta >= MIN_MATERIAL_DELTA) return winner;
  const keep = keepCurrentWinner(ctx, params);
  if (spareNeutralityGains && neutralDistance(winner.result) < neutralDistance(keep.result)) {
    return winner;
  }
  return keep;
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
 * Run the two recommendation sweeps (v4 levers, v4.1 objectives).
 * - net-profit ("Cost-recovery optimiser"): bounded multi-tier sweep (std threshold
 *   x std fee x exp fee x exp threshold from unit-driven candidates), uplift forced
 *   off; single-used-tier data degrades to the old 2D sweep on that tier. Objective
 *   (v4.1): lexicographic cost recovery — candidates whose |revenue - cost| is
 *   within 2% of carrier spend are neutral; among neutral, max contribution wins;
 *   otherwise minimise the distance to neutral (tie-broken by contribution).
 * - basket-builder: unit-driven thresholds (clusters + one typical unit, window
 *   overridden to the typical unit price) when unitStats is present; otherwise the
 *   previous slider-window sweep on the dominant paid tier. Objective: expected
 *   total contribution delta vs the current scheme (shipping P&L + product-margin
 *   effects).
 * Abandonment applies to both. Winners under the $1 materiality floor collapse to
 * keep-current (cost-recovery spares neutrality improvements).
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
  // Materiality floor (v4.1) — evaluated with each option's own params so the
  // keep-current evaluation is the exact no-op the comparison table will show.
  // Cost-recovery spares neutrality improvements (see applyMaterialityFloor).
  netProfit = applyMaterialityFloor(ctx, netProfit, { ...behavior, upliftRate: 0 }, true);

  const basketParams: BehaviorParams = unitStats
    ? { ...behavior, upliftWindow: unitStats.typicalUnitPrice }
    : behavior;
  const basket = applyMaterialityFloor(
    ctx,
    unitStats
      ? sweepBasketUnitDriven(ctx, valid, behavior, unitStats, usedTiers)
      : sweepBasketFallback(ctx, valid, behavior, dominant),
    basketParams,
    false
  );

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
    toRecommended("net-profit", "Cost-recovery optimiser", netProfit),
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
