import { cheapestTier, tierCost } from "./tiers";
import { Benchmark, CanonicalTier, ScenarioResult, Scheme, TaggedOrder } from "./types";

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

function emptyByTier(): Record<CanonicalTier, number> {
  return { standard: 0, express: 0, nextday: 0, sameday: 0 };
}

/** Current state: each order stays in its actual chosen tier. */
export function currentScenario(
  orders: TaggedOrder[],
  scheme: Scheme
): ScenarioResult {
  let shippingRevenue = 0;
  let carrierSpend = 0;
  const ordersByTier = emptyByTier();
  for (const o of orders) {
    const config = scheme[o.tier];
    if (!config) continue;
    shippingRevenue += tierCost(config, o.gross);
    carrierSpend += config.avgCost;
    ordersByTier[o.tier] += 1;
  }
  return {
    shippingRevenue,
    carrierSpend,
    ordersByTier,
    netShippingProfit: shippingRevenue - carrierSpend,
  };
}

/** Proposed state: each order lands per the revealed-WTP model. */
export function proposedScenario(
  orders: TaggedOrder[],
  current: Scheme,
  proposed: Scheme
): ScenarioResult {
  let shippingRevenue = 0;
  let carrierSpend = 0;
  const ordersByTier = emptyByTier();
  for (const o of orders) {
    const landed = landedTier(o, current, proposed);
    const config = proposed[landed];
    if (!config) continue;
    shippingRevenue += tierCost(config, o.gross);
    carrierSpend += config.avgCost;
    ordersByTier[landed] += 1;
  }
  return {
    shippingRevenue,
    carrierSpend,
    ordersByTier,
    netShippingProfit: shippingRevenue - carrierSpend,
  };
}

/** Full current-vs-proposed benchmark. */
export function simulate(
  orders: TaggedOrder[],
  current: Scheme,
  proposed: Scheme,
  cogsPercent?: number
): Benchmark {
  const currentResult = currentScenario(orders, current);
  const proposedResult = proposedScenario(orders, current, proposed);

  const actualShippingPaid = orders.reduce((s, o) => s + o.shippingPaid, 0);
  const variancePct =
    actualShippingPaid > 0
      ? Math.abs(currentResult.shippingRevenue - actualShippingPaid) /
        actualShippingPaid
      : 0;

  const shippingRevenueDelta =
    proposedResult.shippingRevenue - currentResult.shippingRevenue;
  const carrierSpendDelta =
    proposedResult.carrierSpend - currentResult.carrierSpend;

  const cogsContext =
    cogsPercent !== undefined
      ? {
          cogsPercent,
          grossProductMargin:
            orders.reduce((s, o) => s + o.gross, 0) * (1 - cogsPercent),
        }
      : undefined;

  return {
    current: currentResult,
    proposed: proposedResult,
    shippingRevenueDelta,
    carrierSpendDelta,
    netProfitDelta: shippingRevenueDelta - carrierSpendDelta,
    reconciliation: {
      actualShippingPaid,
      modelledCurrentRevenue: currentResult.shippingRevenue,
      variancePct,
    },
    ...(cogsContext ? { cogsContext } : {}),
  };
}
