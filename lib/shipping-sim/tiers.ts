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
  let bestTier: CanonicalTier | null = null;
  let bestCost = 0;
  for (const tier of CANONICAL_TIERS) {
    const config = scheme[tier];
    if (!config) continue;
    const cost = tierCost(config, gross);
    if (bestTier === null || cost < bestCost) {
      bestTier = tier;
      bestCost = cost;
    }
  }
  if (bestTier === null) {
    throw new Error("Scheme has no configured tiers");
  }
  return { tier: bestTier, cost: bestCost };
}
