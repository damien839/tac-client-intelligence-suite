import { cheapestTier, tierCost } from "./tiers";
import { Scheme, TaggedOrder } from "./types";

/**
 * Speed premium the customer revealed under the current scheme:
 * how much extra they paid for their chosen tier over the cheapest option.
 *
 * This is the one behavioural fact the report uses, and it is measured from the
 * upload rather than assumed: an order that paid $10 more for Express has shown
 * it will pay at least $10 more for Express. `mechanicalScenario` uses it to
 * decide whether a candidate scheme prices a customer out of their own choice.
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
