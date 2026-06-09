import {
  CANONICAL_TIERS,
  CanonicalTier,
  Scheme,
  TierConfig,
} from "./types";

/** Cost of a single tier for a given cart value. */
export function tierCost(config: TierConfig, gross: number): number {
  if (config.freeThreshold !== null && gross >= config.freeThreshold) {
    return 0;
  }
  return config.fee;
}

/**
 * Cheapest tier in the scheme for a given cart value.
 * Iterates in CANONICAL_TIERS order with strict `<`, so ties break toward
 * the earliest (slowest/cheapest) tier — standard first.
 */
export function cheapestTier(
  scheme: Scheme,
  gross: number
): { tier: CanonicalTier; cost: number } {
  let best: { tier: CanonicalTier; cost: number } | null = null;
  for (const tier of CANONICAL_TIERS) {
    const config = scheme[tier];
    if (!config) continue;
    const cost = tierCost(config, gross);
    if (best === null || cost < best.cost) {
      best = { tier, cost };
    }
  }
  if (best === null) {
    throw new Error("Scheme has no configured tiers");
  }
  return best;
}
