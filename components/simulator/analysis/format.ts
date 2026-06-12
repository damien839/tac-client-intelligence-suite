import { formatCurrency } from "@/lib/calculations";
import {
  CANONICAL_TIERS,
  CanonicalTier,
  Scheme,
  SchemeEvaluation,
  TIER_LABELS,
  TierConfig,
} from "@/lib/shipping-sim/types";

/** Human summary of a tier config: "$9.95, free over $100" / "$9.95 flat" / "—". */
export function describeStandard(config: TierConfig | undefined): string {
  if (!config) return "—";
  return config.freeThreshold === null
    ? `${formatCurrency(config.fee)} flat`
    : `${formatCurrency(config.fee)}, free over $${config.freeThreshold}`;
}

/**
 * Human summary of what an option changes vs current — one clause per changed tier,
 * e.g. "Standard $9.95, free over $250 · Express $50.00 flat".
 */
export function describeChangedTiers(scheme: Scheme, changedTiers: CanonicalTier[]): string {
  if (changedTiers.length === 0) return "no change vs current";
  return changedTiers
    .map((tier) => `${TIER_LABELS[tier]} ${describeStandard(scheme[tier])}`)
    .join(" · ");
}

/** Currency string with an explicit leading "+" for non-negative values. Values below
 * display precision (half a cent, incl. negative zero and float residue) normalise to 0
 * so a no-op never renders as "-$0.00". */
export function signedCurrency(n: number): string {
  const normalized = Math.abs(n) < 0.005 ? 0 : n;
  return (normalized >= 0 ? "+" : "") + formatCurrency(normalized);
}

/**
 * Freight-shift narrative for an option that moves volume between services: names the
 * tier gaining the most EV-weighted orders and the carrier saving (from the per-tier
 * spend deltas). Null when no meaningful volume moves or carrier costs don't fall.
 */
export function freightShiftSentence(
  evaluation: SchemeEvaluation,
  currentFacts: SchemeEvaluation
): string | null {
  const gains = CANONICAL_TIERS.map((tier) => ({
    tier,
    delta: evaluation.volumeByTier[tier] - currentFacts.volumeByTier[tier],
  })).filter((g) => g.delta >= 0.05);
  if (gains.length === 0) return null;
  const top = gains.reduce((a, b) => (b.delta > a.delta ? b : a));
  const carrierSaving = CANONICAL_TIERS.reduce(
    (sum, tier) =>
      sum + (currentFacts.carrierSpendByTier[tier] - evaluation.carrierSpendByTier[tier]),
    0
  );
  if (carrierSaving < 0.005) return null;
  return `It moves ${top.delta.toFixed(1)} orders to ${TIER_LABELS[top.tier]}, saving ${formatCurrency(carrierSaving)} in carrier costs.`;
}
