import { describe, it, expect } from "vitest";
import { revealedPremium, landedTier } from "@/lib/shipping-sim/model";
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
