import { changedTiersOf, analysableOrders, evaluateScheme } from "./evaluate";
import { dominantTier } from "./scenario";
import {
  CANONICAL_TIERS,
  CandidateScheme,
  Scheme,
  SchemeEvaluation,
  TaggedOrder,
  TIER_LABELS,
} from "./types";

/**
 * Candidate thresholds are round numbers — merchants price in $25 steps, not $237.
 * Low-value books get a $5 step instead: at $25 a book whose p75 is under $12.50
 * rounds every candidate to $0 and the grid collapses to nothing.
 */
export const CANDIDATE_ROUNDING = 25;
export const CANDIDATE_ROUNDING_LOW_AOV = 5;
/** Below this p75 order value the book is priced too finely for $25 steps. */
export const LOW_AOV_P75 = 50;

/** Order-value percentiles the candidate thresholds are drawn from. */
export const CANDIDATE_PERCENTILES = [0.25, 0.5, 0.75] as const;

/** Nearest-neighbour percentile of an ascending array. */
function percentileOf(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

/** $25 steps normally; $5 on a low-AOV book so the candidates don't all round to $0. */
export function candidateRoundingFor(sortedGross: number[]): number {
  const p75 = percentileOf(sortedGross, 0.75);
  return p75 < LOW_AOV_P75 ? CANDIDATE_ROUNDING_LOW_AOV : CANDIDATE_ROUNDING;
}

/**
 * Candidate free-shipping thresholds spanning the order-value curve: the p25 / p50 /
 * p75 order values rounded to the nearest step. Deduped, ascending, zero dropped
 * (a $0 threshold is the separate "free on everything" candidate).
 */
export function percentileThresholds(orders: TaggedOrder[]): number[] {
  const sorted = orders.map((order) => order.gross).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const step = candidateRoundingFor(sorted);
  const rounded = CANDIDATE_PERCENTILES.map(
    (p) => Math.round(percentileOf(sorted, p) / step) * step
  ).filter((t) => t > 0);
  return Array.from(new Set(rounded)).sort((a, b) => a - b);
}

/**
 * Stable identity of a scheme — used to drop candidates that duplicate another row.
 * avgCost is part of the identity: two schemes with the same fees but different
 * carrier costs are different schemes, and omitting it would silently swallow one.
 */
function schemeSignature(scheme: Scheme): string {
  return CANONICAL_TIERS.map((tier) => {
    const config = scheme[tier];
    return config
      ? `${tier}:${config.fee}:${config.freeThreshold ?? "flat"}:${config.avgCost}`
      : `${tier}:-`;
  }).join("|");
}

/**
 * The candidate comparison grid: the current scheme plus a small set of round-number
 * alternatives on the tier that carries most volume, each differing from current by
 * exactly one lever (that tier's free-shipping line).
 *
 * Candidates:
 * - Current scheme (the baseline every delta is measured against)
 * - p25 / p50 / p75 order value rounded to the step — free-over lines spanning the curve
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
  const dominant = dominantTier(valid, current);
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

/** Economic identity of a row — two rows with these equal say the same thing. */
function outcomeSignature(evaluation: SchemeEvaluation): string {
  return `${evaluation.shippingRevenue.toFixed(4)}|${evaluation.carrierSpend.toFixed(4)}`;
}

/**
 * Evaluate every candidate mechanically. The current scheme stays pinned first — it
 * is the baseline the deltas are measured from — and the rest are ordered by net
 * shipping P&L delta, descending. Ordering is presentation only: no row is a
 * recommendation, and rows below current show a negative delta.
 *
 * Rows whose outcome duplicates an earlier row are dropped. Distinct schemes can be
 * economically identical (on an all-free book every threshold collects $0), and
 * rendering five rows of the same numbers reads as five different answers.
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
  const rest = [...evaluated.filter((row) => row.candidate.id !== "current")].sort(
    (a, b) => b.evaluation.netShippingProfitDelta - a.evaluation.netShippingProfitDelta
  );

  const seenOutcome = new Set(baseline.map((row) => outcomeSignature(row.evaluation)));
  const deduped: EvaluatedCandidate[] = [];
  for (const row of rest) {
    const signature = outcomeSignature(row.evaluation);
    if (seenOutcome.has(signature)) continue;
    seenOutcome.add(signature);
    deduped.push(row);
  }
  return [...baseline, ...deduped];
}
