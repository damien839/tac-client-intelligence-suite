import { changedTiersOf, analysableOrders, evaluateScheme } from "./evaluate";
import { dominantPaidTier } from "./scenario";
import {
  CANONICAL_TIERS,
  CandidateScheme,
  Scheme,
  SchemeEvaluation,
  TaggedOrder,
  TIER_LABELS,
} from "./types";

/** Candidate thresholds are round numbers — merchants price in $25 steps, not $237. */
export const CANDIDATE_ROUNDING = 25;

/** Order-value percentiles the candidate thresholds are drawn from. */
export const CANDIDATE_PERCENTILES = [0.25, 0.5, 0.75] as const;

/** Nearest-neighbour percentile of an ascending array. */
function percentileOf(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

/**
 * Candidate free-shipping thresholds spanning the order-value curve: the p25 / p50 /
 * p75 order values rounded to the nearest $25. Deduped, ascending, zero dropped
 * (a $0 threshold is the separate "free on everything" candidate).
 */
export function percentileThresholds(orders: TaggedOrder[]): number[] {
  const sorted = orders.map((order) => order.gross).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const rounded = CANDIDATE_PERCENTILES.map(
    (p) => Math.round(percentileOf(sorted, p) / CANDIDATE_ROUNDING) * CANDIDATE_ROUNDING
  ).filter((t) => t > 0);
  return Array.from(new Set(rounded)).sort((a, b) => a - b);
}

/** Stable identity of a scheme — used to drop candidates that duplicate another row. */
function schemeSignature(scheme: Scheme): string {
  return CANONICAL_TIERS.map((tier) => {
    const config = scheme[tier];
    return config ? `${tier}:${config.fee}:${config.freeThreshold ?? "flat"}` : `${tier}:-`;
  }).join("|");
}

/**
 * The candidate comparison grid: the current scheme plus a small set of round-number
 * alternatives on the tier that carries most paid volume, each differing from current
 * by exactly one lever (that tier's free-shipping line).
 *
 * Candidates:
 * - Current scheme (the baseline every delta is measured against)
 * - p25 / p50 / p75 order value rounded to $25 — free-over lines spanning the curve
 * - Free shipping on all orders (threshold $0)
 * - No free shipping (flat fee, threshold removed)
 * - The caller's competitor benchmark, when supplied and different from current
 *
 * This is a comparison set, not an optimiser: nothing here searches for a "best"
 * scheme, because with behaviour held fixed an unconstrained profit search always
 * degenerates to "charge everyone the maximum".
 */
export function buildCandidates(
  orders: TaggedOrder[],
  current: Scheme,
  competitor?: Scheme
): CandidateScheme[] {
  const valid = analysableOrders(orders, current);
  if (valid.length === 0) return [];
  const dominant = dominantPaidTier(valid, current);
  if (!dominant) return [];
  const target = current[dominant]!;
  const tierLabel = TIER_LABELS[dominant];

  const withThreshold = (freeThreshold: number | null): Scheme => ({
    ...current,
    [dominant]: { ...target, freeThreshold },
  });

  const drafts: Omit<CandidateScheme, "changedTiers" | "isCurrent">[] = [
    { id: "current", label: "Current scheme", shortLabel: "Current", scheme: current },
    ...percentileThresholds(valid).map((threshold) => ({
      id: `threshold-${threshold}`,
      label: `${tierLabel} free over $${threshold}`,
      shortLabel: `Free $${threshold}`,
      scheme: withThreshold(threshold),
    })),
    {
      id: "all-free",
      label: `${tierLabel} free on all orders`,
      shortLabel: "All free",
      scheme: withThreshold(0),
    },
    {
      id: "no-free",
      label: `${tierLabel} no free shipping`,
      shortLabel: "No free",
      scheme: withThreshold(null),
    },
    ...(competitor ? [{
      id: "competitor",
      label: "Competitor benchmark",
      shortLabel: "Competitor",
      scheme: competitor,
    }] : []),
  ];

  const seen = new Set<string>();
  const candidates: CandidateScheme[] = [];
  for (const draft of drafts) {
    const signature = schemeSignature(draft.scheme);
    if (seen.has(signature)) continue;
    seen.add(signature);
    const changedTiers = changedTiersOf(current, draft.scheme);
    candidates.push({ ...draft, changedTiers, isCurrent: changedTiers.length === 0 });
  }
  return candidates;
}

/** One evaluated row of the comparison grid. */
export interface EvaluatedCandidate {
  candidate: CandidateScheme;
  evaluation: SchemeEvaluation;
}

/**
 * Evaluate every candidate mechanically. The current scheme stays pinned first — it
 * is the baseline the deltas are measured from — and the rest are ordered by net
 * shipping P&L delta, descending. Ordering is presentation only: no row is a
 * recommendation, and rows below current show a negative delta.
 */
export function evaluateCandidates(
  orders: TaggedOrder[],
  current: Scheme,
  candidates: CandidateScheme[]
): EvaluatedCandidate[] {
  const evaluated = candidates.flatMap((candidate): EvaluatedCandidate[] => {
    const evaluation = evaluateScheme(orders, current, candidate.scheme);
    return evaluation ? [{ candidate, evaluation }] : [];
  });
  const baseline = evaluated.filter((row) => row.candidate.id === "current");
  const rest = evaluated
    .filter((row) => row.candidate.id !== "current")
    .toSorted(
      (a, b) => b.evaluation.netShippingProfitDelta - a.evaluation.netShippingProfitDelta
    );
  return [...baseline, ...rest];
}
