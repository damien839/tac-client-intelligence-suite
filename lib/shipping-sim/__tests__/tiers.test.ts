import { describe, it, expect } from "vitest";
import { tierCost, cheapestTier } from "@/lib/shipping-sim/tiers";
import { Scheme, TierConfig } from "@/lib/shipping-sim/types";

const std: TierConfig = { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 };
const exp: TierConfig = { tier: "express", fee: 15, freeThreshold: 200, avgCost: 12 };
const flatExp: TierConfig = { tier: "express", fee: 15, freeThreshold: null, avgCost: 12 };

describe("tierCost", () => {
  it("charges the fee below threshold", () => {
    expect(tierCost(std, 80)).toBe(10);
  });
  it("is free at or above threshold", () => {
    expect(tierCost(std, 100)).toBe(0);
    expect(tierCost(std, 150)).toBe(0);
  });
  it("always charges when threshold is null (flat)", () => {
    expect(tierCost(flatExp, 500)).toBe(15);
  });
});

describe("cheapestTier", () => {
  const scheme: Scheme = { standard: std, express: exp };
  it("returns the lowest-cost tier for the cart value", () => {
    // gross 150: standard free (0), express $15 -> standard cheapest
    expect(cheapestTier(scheme, 150)).toEqual({ tier: "standard", cost: 0 });
  });
  it("breaks ties toward the earliest canonical tier (standard)", () => {
    // gross 250: both free (0) -> standard wins the tie
    expect(cheapestTier(scheme, 250)).toEqual({ tier: "standard", cost: 0 });
  });
  it("returns the only tier when the scheme has a single entry", () => {
    expect(cheapestTier({ standard: std }, 50)).toEqual({ tier: "standard", cost: 10 });
  });
  it("throws when the scheme has no tiers", () => {
    expect(() => cheapestTier({}, 100)).toThrow();
  });
});
