import { describe, it, expect } from "vitest";
import { bucketOrders, prepareBuckets, behavioralScenario } from "@/lib/shipping-sim/recommend";
import { proposedScenario } from "@/lib/shipping-sim/model";
import { BehaviorParams, CanonicalTier, Scheme, TaggedOrder } from "@/lib/shipping-sim/types";

function o(gross: number, tier: CanonicalTier): TaggedOrder {
  return { gross, shippingPaid: 0, rawService: "x", tier };
}

const current: Scheme = {
  standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 },
  express: { tier: "express", fee: 15, freeThreshold: 200, avgCost: 12 },
};

const ZERO: BehaviorParams = { cogsPercent: 0.4, upliftRate: 0, upliftWindow: 20, abandonRate: 0 };

describe("behavioralScenario", () => {
  it("reduces exactly to proposedScenario when behaviour is zeroed", () => {
    const orders = [
      o(80, "standard"),
      o(150, "standard"),
      o(150, "express"),
      o(250, "express"),
      o(80, "standard"),
    ];
    const candidate: Scheme = {
      standard: { tier: "standard", fee: 15, freeThreshold: 150, avgCost: 7 },
      express: { tier: "express", fee: 25, freeThreshold: 250, avgCost: 12 },
    };
    const prepared = prepareBuckets(bucketOrders(orders), current);
    const r = behavioralScenario(prepared, candidate, ZERO);
    const expected = proposedScenario(orders, current, candidate);
    expect(r.shippingRevenue).toBeCloseTo(expected.shippingRevenue);
    expect(r.carrierSpend).toBeCloseTo(expected.carrierSpend);
    expect(r.netShippingProfit).toBeCloseTo(expected.netShippingProfit);
    expect(r.upliftMarginGain).toBe(0);
    expect(r.abandonMarginLoss).toBe(0);
    expect(r.expectedOrdersLost).toBe(0);
  });

  it("applies basket-building uplift to in-window paying orders", () => {
    // gross 90, std fee 10 / free over 100, window 20 -> in window [80, 100).
    // uplift 0.5: half build (free, margin gain (100-90)*0.6), half pay $10. Not worse off -> no abandonment.
    const stdOnly: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 } };
    const prepared = prepareBuckets(bucketOrders([o(90, "standard")]), stdOnly);
    const r = behavioralScenario(prepared, stdOnly, {
      cogsPercent: 0.4,
      upliftRate: 0.5,
      upliftWindow: 20,
      abandonRate: 0,
    });
    expect(r.shippingRevenue).toBeCloseTo(5); // 0.5 * 10
    expect(r.carrierSpend).toBeCloseTo(7); // builders still ship
    expect(r.upliftMarginGain).toBeCloseTo(3); // 0.5 * 10 * (1 - 0.4)
    expect(r.freeOrderShare).toBeCloseTo(0.5);
    expect(r.expectedOrdersLost).toBe(0);
  });

  it("applies abandonment to worse-off orders", () => {
    // gross 80 currently pays $10; candidate raises std fee to $20 -> worse off.
    // abandon 0.25: quarter lost (margin loss 80*0.5), rest pay $20. Uplift off.
    const stdOnly: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 } };
    const candidate: Scheme = { standard: { tier: "standard", fee: 20, freeThreshold: 100, avgCost: 7 } };
    const prepared = prepareBuckets(bucketOrders([o(80, "standard")]), stdOnly);
    const r = behavioralScenario(prepared, candidate, {
      cogsPercent: 0.5,
      upliftRate: 0,
      upliftWindow: 20,
      abandonRate: 0.25,
    });
    expect(r.shippingRevenue).toBeCloseTo(15); // 0.75 * 20
    expect(r.carrierSpend).toBeCloseTo(5.25); // 0.75 * 7
    expect(r.abandonMarginLoss).toBeCloseTo(10); // 0.25 * 80 * 0.5
    expect(r.expectedOrdersLost).toBeCloseTo(0.25);
    expect(r.freeOrderShare).toBe(0);
  });

  it("splits weight build / abandon / pay for an in-window, worse-off order", () => {
    // gross 85, candidate fee 20 (worse than current 10), threshold 100, window 20 -> in window.
    // uplift 0.4 builds; of remaining 0.6, abandon 0.5 -> 0.3 abandons, 0.3 pays.
    const stdOnly: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 } };
    const candidate: Scheme = { standard: { tier: "standard", fee: 20, freeThreshold: 100, avgCost: 7 } };
    const prepared = prepareBuckets(bucketOrders([o(85, "standard")]), stdOnly);
    const r = behavioralScenario(prepared, candidate, {
      cogsPercent: 0,
      upliftRate: 0.4,
      upliftWindow: 20,
      abandonRate: 0.5,
    });
    expect(r.shippingRevenue).toBeCloseTo(6); // 0.3 * 20
    expect(r.carrierSpend).toBeCloseTo(4.9); // (0.4 + 0.3) * 7
    expect(r.upliftMarginGain).toBeCloseTo(6); // 0.4 * (100 - 85) * 1
    expect(r.abandonMarginLoss).toBeCloseTo(25.5); // 0.3 * 85 * 1
    expect(r.expectedOrdersLost).toBeCloseTo(0.3);
    expect(r.freeOrderShare).toBeCloseTo(0.4 / 0.7); // builders / completing
  });
});

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
