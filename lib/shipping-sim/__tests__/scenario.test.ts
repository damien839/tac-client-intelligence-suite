import { describe, it, expect } from "vitest";
import {
  bucketOrders,
  dominantTier,
  mechanicalScenario,
  prepareBuckets,
  thresholdCandidates,
} from "@/lib/shipping-sim/scenario";
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
  it("prices every order by hand-checkable revealed preference", () => {
    // Current: std $10 free>=100 (cost 7), exp $20 flat (cost 15).
    // Candidate: std $12 free>=200, exp $25 flat.
    //   $50  std  -> premium 0; stay std ($12) vs cheapest std ($12) -> std, pays 12
    //   $90  std  -> premium 0; std, pays 12
    //   $150 std  -> premium 0; std, pays 12 (candidate free line moved to 200)
    //   $120 exp  -> premium 20-0 = 20; stay exp costs 25 - cheapest 12 = 13 <= 20 -> exp, pays 25
    //   $60  exp  -> premium 20-10 = 10; stay exp 25 - 12 = 13 > 10 -> switches to std, pays 12
    const orders = [o(50), o(90), o(150), o(120, "express"), o(60, "express")];
    const candidate: Scheme = {
      standard: { tier: "standard", fee: 12, freeThreshold: 200, avgCost: 7 },
      express: { tier: "express", fee: 25, freeThreshold: null, avgCost: 15 },
    };
    const result = run(orders, candidate);
    expect(result.shippingRevenue).toBeCloseTo(12 + 12 + 12 + 25 + 12);
    expect(result.carrierSpend).toBeCloseTo(7 * 4 + 15);
    expect(result.volumeByTier.standard).toBe(4);
    expect(result.volumeByTier.express).toBe(1);
    expect(result.impact.switchedTier).toBe(1);
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

  // REGRESSION (challenge #3): bucketing used to round gross to the dollar above
  // 5000 distinct pairs, which pushed $249.60 over a $250 free line — the same
  // order priced differently depending on how big the upload happened to be.
  it("never rounds gross, however many distinct values the book has", () => {
    const orders = Array.from({ length: 5004 }, (_, i) => o(100 + i / 1000));
    const buckets = bucketOrders(orders);
    expect(buckets).toHaveLength(5004); // exact, not collapsed
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(5004);
    expect(buckets.every((b) => Number.isInteger(b.gross))).toBe(false);
  });

  it("prices sub-dollar values against the free line identically at any book size", () => {
    const near: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 250, avgCost: 6 } };
    const justUnder = [o(249.6), o(249.7), o(249.9)];
    const small = run(justUnder, near, near);
    const big = run(
      [...justUnder, ...Array.from({ length: 5001 }, (_, i) => o(1 + i * 0.017))],
      near,
      near
    );
    expect(small.freeOrderShare).toBe(0); // none of the three clears $250
    expect(big.freeOrderShare * big.orderCount).toBe(0);
    expect(big.shippingRevenue).toBeCloseTo(5004 * 10);
  });
});

describe("dominantTier", () => {
  it("picks the tier carrying the most orders", () => {
    const orders = [o(50), o(60), o(150, "express"), o(50, "express")];
    expect(dominantTier(orders, current)).toBe("standard");
  });

  // REGRESSION (challenge #6): ranking by PAID count sent the grid at a 10-order
  // Express tier and never explored the free line on the 80-order Standard tier.
  it("prefers the high-volume mostly-free tier over a small all-paying tier", () => {
    const orders = [
      ...Array.from({ length: 80 }, () => o(200)), // standard, all free (>= $100)
      ...Array.from({ length: 10 }, () => o(50, "express")), // express, all paying
    ];
    expect(dominantTier(orders, current)).toBe("standard");
  });

  it("breaks a volume tie on paid count", () => {
    const orders = [o(200), o(210), o(50, "express"), o(60, "express")];
    // 2 standard (both free) vs 2 express (both paying) -> express wins on paid count
    expect(dominantTier(orders, current)).toBe("express");
  });

  it("returns null without analysable orders", () => {
    expect(dominantTier([], current)).toBeNull();
    expect(dominantTier([o(50, "nextday")], current)).toBeNull();
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
