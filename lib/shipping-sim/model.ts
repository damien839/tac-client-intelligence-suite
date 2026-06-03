import { cheapestTier, tierCost } from "./tiers";
import { CanonicalTier, Scheme, TaggedOrder } from "./types";

/**
 * Speed premium the customer revealed under the current scheme:
 * how much extra they paid for their chosen tier over the cheapest option.
 */
export function revealedPremium(order: TaggedOrder, current: Scheme): number {
  const chosen = current[order.tier];
  if (!chosen) {
    throw new Error(`Order tier ${order.tier} is not in the current scheme`);
  }
  const chosenCost = tierCost(chosen, order.gross);
  const cheapest = cheapestTier(current, order.gross).cost;
  return chosenCost - cheapest;
}

/**
 * Tier the order lands in under the proposed scheme.
 * Keeps the chosen tier if its proposed premium is within revealed WTP,
 * otherwise drops to the cheapest proposed tier.
 */
export function landedTier(
  order: TaggedOrder,
  current: Scheme,
  proposed: Scheme
): CanonicalTier {
  const premium = revealedPremium(order, current);
  const cheapest = cheapestTier(proposed, order.gross);
  const chosen = proposed[order.tier];
  if (!chosen) return cheapest.tier; // chosen tier no longer offered
  const stayPremium = tierCost(chosen, order.gross) - cheapest.cost;
  return stayPremium <= premium ? order.tier : cheapest.tier;
}
