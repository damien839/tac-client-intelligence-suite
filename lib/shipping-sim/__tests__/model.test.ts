import { describe, it, expect } from "vitest";
import {
  revealedPremium,
  landedTier,
  currentScenario,
  proposedScenario,
  simulate,
} from "@/lib/shipping-sim/model";
import { Scheme, TaggedOrder, TierConfig } from "@/lib/shipping-sim/types";

const std: TierConfig = { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 };
const exp: TierConfig = { tier: "express", fee: 15, freeThreshold: 200, avgCost: 12 };
const current: Scheme = { standard: std, express: exp };

function order(gross: number, tier: TaggedOrder["tier"]): TaggedOrder {
  return { gross, shippingPaid: 0, rawService: "x", tier };
}

describe("revealedPremium", () => {
  it("is 0 when the customer chose the cheapest tier", () => {
    // gross 150: standard free(0), express $15. Chose standard -> premium 0.
    expect(revealedPremium(order(150, "standard"), current)).toBe(0);
  });
  it("is the extra paid over the cheapest option", () => {
    // gross 150: chose express ($15) over free standard -> premium 15.
    expect(revealedPremium(order(150, "express"), current)).toBe(15);
  });
});

describe("landedTier", () => {
  it("keeps the tier when the proposed premium is within revealed WTP", () => {
    // revealed 15 (express @150). Proposed express premium 10 (<=15) -> stay express.
    const proposed: Scheme = {
      standard: { ...std, fee: 15, freeThreshold: 150 }, // std costs 15 at gross 140
      express: { ...exp, fee: 25, freeThreshold: 200 }, // express costs 25 at gross 140 -> premium 10
    };
    expect(landedTier(order(140, "express"), current, proposed)).toBe("express");
  });
  it("drops to cheapest when proposed premium exceeds revealed WTP", () => {
    // revealed 15 (express @150). Proposed express premium 20 (>15) -> drop to standard.
    const proposed: Scheme = {
      standard: { ...std, fee: 10, freeThreshold: 150 }, // std costs 10 at gross 140
      express: { ...exp, fee: 30, freeThreshold: 200 }, // express costs 30 -> premium 20
    };
    expect(landedTier(order(140, "express"), current, proposed)).toBe("standard");
  });
  it("drops to cheapest when the chosen tier is removed from the proposed scheme", () => {
    const proposed: Scheme = { standard: { ...std, fee: 12, freeThreshold: 150 } };
    expect(landedTier(order(140, "express"), current, proposed)).toBe("standard");
  });
});

describe("currentScenario", () => {
  it("sums revenue and carrier cost from the actual chosen tiers", () => {
    const orders: TaggedOrder[] = [
      order(80, "standard"), // std fee 10, cost 7
      order(150, "standard"), // std free 0, cost 7
      order(150, "express"), // exp fee 15, cost 12
    ];
    const r = currentScenario(orders, current);
    expect(r.shippingRevenue).toBe(25); // 10 + 0 + 15
    expect(r.carrierSpend).toBe(26); // 7 + 7 + 12
    expect(r.netShippingProfit).toBe(-1);
    expect(r.ordersByTier).toEqual({ standard: 2, express: 1, nextday: 0, sameday: 0 });
  });
});

describe("proposedScenario", () => {
  it("routes each order through landedTier and counts tier switches", () => {
    // gross 140, chose express (revealed premium 15); proposed express premium 20 -> drops to standard
    const orders: TaggedOrder[] = [order(140, "express")];
    const proposed: Scheme = {
      standard: { ...std, fee: 10, freeThreshold: 150 },
      express: { ...exp, fee: 30, freeThreshold: 200 },
    };
    const r = proposedScenario(orders, current, proposed);
    expect(r.ordersByTier.standard).toBe(1);
    expect(r.ordersByTier.express).toBe(0);
  });
});

describe("simulate", () => {
  it("computes deltas, reconciliation, and omits cogs context when no cogs", () => {
    const orders: TaggedOrder[] = [
      { gross: 80, shippingPaid: 10, rawService: "x", tier: "standard" },
      { gross: 150, shippingPaid: 15, rawService: "x", tier: "express" },
    ];
    // Proposal: standard free over 150 (so the $80 order still pays), express premium rises
    const proposed: Scheme = {
      standard: { tier: "standard", fee: 15, freeThreshold: 150, avgCost: 7 },
      express: { tier: "express", fee: 25, freeThreshold: 250, avgCost: 12 },
    };
    const b = simulate(orders, current, proposed, undefined);
    expect(b.reconciliation.actualShippingPaid).toBe(25); // 10 + 15
    expect(b.reconciliation.modelledCurrentRevenue).toBe(b.current.shippingRevenue);
    expect(b.netProfitDelta).toBe(b.shippingRevenueDelta - b.carrierSpendDelta);
    expect(b.cogsContext).toBeUndefined();
  });

  it("adds cogs context without changing the delta", () => {
    const orders: TaggedOrder[] = [order(80, "standard")];
    const proposed: Scheme = { standard: { ...std, fee: 12 } };
    const withCogs = simulate(orders, current, proposed, 0.3);
    const without = simulate(orders, current, proposed, undefined);
    expect(withCogs.netProfitDelta).toBe(without.netProfitDelta);
    expect(withCogs.cogsContext).toEqual({ cogsPercent: 0.3, grossProductMargin: 80 * 0.7 });
  });

  it("reconciliation variance is 0 when actual paid is 0 (guard)", () => {
    const orders: TaggedOrder[] = [{ gross: 80, shippingPaid: 0, rawService: "x", tier: "standard" }];
    const b = simulate(orders, current, { standard: std }, undefined);
    expect(b.reconciliation.variancePct).toBe(0);
  });

  it("handles empty orders without throwing", () => {
    const b = simulate([], current, { standard: std }, undefined);
    expect(b.current.shippingRevenue).toBe(0);
    expect(b.reconciliation.variancePct).toBe(0);
  });

  it("all-free scheme (threshold 0) collects zero shipping revenue", () => {
    const allFree: Scheme = {
      standard: { tier: "standard", fee: 10, freeThreshold: 0, avgCost: 7 },
      express: { tier: "express", fee: 15, freeThreshold: 0, avgCost: 12 },
    };
    const orders: TaggedOrder[] = [order(80, "standard"), order(150, "express")];
    const r = simulate(orders, allFree, allFree, undefined);
    expect(r.current.shippingRevenue).toBe(0);
    expect(r.current.carrierSpend).toBe(19); // 7 + 12
    expect(r.shippingRevenueDelta).toBe(0);
  });

  it("all-flat scheme (null threshold) always charges the fee regardless of cart value", () => {
    const allFlat: Scheme = {
      standard: { tier: "standard", fee: 10, freeThreshold: null, avgCost: 7 },
      express: { tier: "express", fee: 15, freeThreshold: null, avgCost: 12 },
    };
    const orders: TaggedOrder[] = [order(500, "standard"), order(500, "express")];
    const r = simulate(orders, allFlat, allFlat, undefined);
    expect(r.current.shippingRevenue).toBe(25); // 10 + 15, even at $500 cart
  });
});
