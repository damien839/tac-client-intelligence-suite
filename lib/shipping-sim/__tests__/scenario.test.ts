import { describe, it, expect } from "vitest";
import {
  bucketOrders,
  dominantPaidTier,
  mechanicalScenario,
  prepareBuckets,
  thresholdCandidates,
} from "@/lib/shipping-sim/scenario";
import { proposedScenario } from "@/lib/shipping-sim/model";
import { CanonicalTier, Scheme, TaggedOrder } from "@/lib/shipping-sim/types";

function o(gross: number, tier: CanonicalTier = "standard"): TaggedOrder {
  return { gross, shippingPaid: 0, rawService: "x", tier };
}

const current: Scheme = {
  standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 },
  express: { tier: "express", fee: 20, freeThreshold: null, avgCost: 15 },
};

function run(orders: TaggedOrder[], candidate: Scheme, scheme: Scheme = current) {
  return mechanicalScenario(prepareBuckets(bucketOrders(orders), scheme), candidate);
}

describe("mechanicalScenario", () => {
  it("matches proposedScenario exactly — it is the same revealed-preference model", () => {
    const orders = [o(50), o(90), o(150), o(120, "express"), o(60, "express")];
    const candidate: Scheme = {
      standard: { tier: "standard", fee: 12, freeThreshold: 200, avgCost: 7 },
      express: { tier: "express", fee: 25, freeThreshold: null, avgCost: 15 },
    };
    const mechanical = run(orders, candidate);
    const reference = proposedScenario(orders, current, candidate);
    expect(mechanical.shippingRevenue).toBeCloseTo(reference.shippingRevenue);
    expect(mechanical.carrierSpend).toBeCloseTo(reference.carrierSpend);
    expect(mechanical.netShippingProfit).toBeCloseTo(reference.netShippingProfit);
    for (const tier of ["standard", "express", "nextday", "sameday"] as CanonicalTier[]) {
      expect(mechanical.volumeByTier[tier]).toBe(reference.ordersByTier[tier]);
    }
  });

  it("evaluating the current scheme against itself is a strict no-op", () => {
    const orders = [o(50), o(150), o(80, "express")];
    const result = run(orders, current);
    // 50 pays 10, 150 free, express 80 pays 20 -> revenue 30; cost 7 + 7 + 15 = 29.
    expect(result.shippingRevenue).toBeCloseTo(30);
    expect(result.carrierSpend).toBeCloseTo(29);
    expect(result.netShippingProfit).toBeCloseTo(1);
    expect(result.impact).toEqual({ newlyPaying: 0, newlyFree: 0, switchedTier: 0 });
  });

  it("computes recovery % as revenue / spend and free share over all orders", () => {
    const orders = [o(50), o(150)]; // one pays $10, one free; cost $14
    const result = run(orders, current);
    expect(result.recoveryRate).toBeCloseTo(10 / 14);
    expect(result.freeOrderShare).toBeCloseTo(0.5);
    expect(result.orderCount).toBe(2);
  });

  it("carrier cost only moves when orders land on a different tier", () => {
    const orders = [o(50), o(90), o(150)];
    // Single-tier book: there is nowhere else to land, so a fee-only change leaves
    // the carrier bill untouched and moves fee revenue alone.
    const stdOnly: Scheme = { standard: current.standard };
    const feeOnly: Scheme = {
      standard: { tier: "standard", fee: 25, freeThreshold: 100, avgCost: 7 },
    };
    const base = run(orders, stdOnly, stdOnly);
    const changed = run(orders, feeOnly, stdOnly);
    expect(changed.carrierSpend).toBeCloseTo(base.carrierSpend);
    expect(changed.impact.switchedTier).toBe(0);
    expect(changed.shippingRevenue).toBeGreaterThan(base.shippingRevenue);
  });

  it("moves carrier cost when a repriced tier pushes orders onto the cheaper service", () => {
    // Express order at $60 revealed a $10 premium ($20 express vs $10 standard).
    const orders = [o(60, "express")];
    const pricyExpress: Scheme = {
      ...current,
      express: { tier: "express", fee: 60, freeThreshold: null, avgCost: 15 },
    };
    const result = run(orders, pricyExpress);
    expect(result.impact.switchedTier).toBe(1);
    expect(result.volumeByTier.standard).toBe(1);
    expect(result.volumeByTier.express).toBe(0);
    expect(result.carrierSpend).toBeCloseTo(7); // standard's carrier cost, not express's
    expect(result.carrierSpendByTier.standard).toBeCloseTo(7);
  });

  it("lands on the cheapest tier when the chosen tier is removed from the candidate", () => {
    const orders = [o(60, "express")];
    const stdOnly: Scheme = { standard: current.standard };
    const result = run(orders, stdOnly);
    expect(result.volumeByTier.standard).toBe(1);
    expect(result.shippingRevenue).toBeCloseTo(10);
  });

  it("counts newly-paying and newly-free orders", () => {
    const orders = [o(150), o(50)]; // free today; pays today
    const flipped: Scheme = {
      ...current,
      standard: { tier: "standard", fee: 10, freeThreshold: 40, avgCost: 7 },
    };
    const result = run(orders, flipped);
    expect(result.impact.newlyPaying).toBe(0);
    expect(result.impact.newlyFree).toBe(1); // the $50 order now clears the $40 line
  });

  it("counts newly-paying when the free line rises above an order", () => {
    const orders = [o(150)];
    const raised: Scheme = {
      ...current,
      standard: { tier: "standard", fee: 10, freeThreshold: 300, avgCost: 7 },
    };
    expect(run(orders, raised).impact.newlyPaying).toBe(1);
  });

  it("reports zero recovery and zero free share on an empty book", () => {
    const result = run([], current);
    expect(result.recoveryRate).toBe(0);
    expect(result.freeOrderShare).toBe(0);
    expect(result.orderCount).toBe(0);
  });
});

describe("bucketOrders", () => {
  it("groups identical (tier, gross) orders", () => {
    const buckets = bucketOrders([o(50), o(50), o(50, "express"), o(60)]);
    expect(buckets).toHaveLength(3);
    expect(buckets.find((b) => b.tier === "standard" && b.gross === 50)!.count).toBe(2);
    expect(buckets.find((b) => b.tier === "express" && b.gross === 50)!.count).toBe(1);
  });

  it("rounds gross to the dollar when distinct buckets exceed the cap, preserving total count", () => {
    const orders = Array.from({ length: 5001 }, (_, i) => o(100 + i / 1000));
    const buckets = bucketOrders(orders);
    expect(buckets.length).toBeLessThanOrEqual(5001);
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(5001);
  });
});

describe("dominantPaidTier", () => {
  it("picks the tier with the most paying orders", () => {
    const orders = [o(50), o(60), o(150, "express"), o(50, "express")];
    expect(dominantPaidTier(orders, current)).toBe("standard");
  });

  it("falls back to total volume when nobody pays, then canonical order", () => {
    const allFree: Scheme = {
      standard: { tier: "standard", fee: 0, freeThreshold: null, avgCost: 7 },
      express: { tier: "express", fee: 0, freeThreshold: null, avgCost: 15 },
    };
    const orders = [o(50, "express"), o(60, "express"), o(50)];
    expect(dominantPaidTier(orders, allFree)).toBe("express");
  });

  it("returns null without analysable orders", () => {
    expect(dominantPaidTier([], current)).toBeNull();
    expect(dominantPaidTier([o(50, "nextday")], current)).toBeNull();
  });
});

describe("thresholdCandidates", () => {
  it("sweeps $0 to max($400, p95 rounded up to $10) in $10 steps, all numeric", () => {
    const orders = Array.from({ length: 100 }, (_, i) => o(i + 1));
    const candidates = thresholdCandidates(orders);
    expect(candidates[0]).toBe(0);
    expect(candidates[candidates.length - 1]).toBe(400);
    expect(candidates.every((t) => typeof t === "number")).toBe(true);
    expect(candidates[1] - candidates[0]).toBe(10);
  });

  it("caps the sweep at $1000", () => {
    const orders = Array.from({ length: 100 }, () => o(50_000));
    expect(thresholdCandidates(orders).at(-1)).toBe(1000);
  });
});
