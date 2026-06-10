import { describe, it, expect } from "vitest";
import { bucketOrders } from "@/lib/shipping-sim/recommend";
import { CanonicalTier, TaggedOrder } from "@/lib/shipping-sim/types";

function o(gross: number, tier: CanonicalTier): TaggedOrder {
  return { gross, shippingPaid: 0, rawService: "x", tier };
}

describe("bucketOrders", () => {
  it("groups identical (tier, gross) orders", () => {
    const buckets = bucketOrders([o(80, "standard"), o(80, "standard"), o(120, "express")]);
    expect(buckets).toHaveLength(2);
    expect(buckets.find((b) => b.tier === "standard")).toEqual({
      tier: "standard",
      gross: 80,
      count: 2,
    });
    expect(buckets.find((b) => b.tier === "express")).toEqual({
      tier: "express",
      gross: 120,
      count: 1,
    });
  });

  it("rounds gross to the dollar when distinct buckets exceed the cap, preserving total count", () => {
    const orders = Array.from({ length: 5001 }, (_, i) => o(10 + i * 0.01, "standard"));
    const buckets = bucketOrders(orders);
    expect(buckets.length).toBeLessThan(200); // 10..60.01 rounds to ~51 distinct dollar values
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(5001);
  });
});
