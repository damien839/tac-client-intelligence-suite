import { describe, it, expect } from "vitest";
import { bucketOrders, prepareBuckets, behavioralScenario, recommendOptions, thresholdCandidates } from "@/lib/shipping-sim/recommend";
import { proposedScenario, currentScenario } from "@/lib/shipping-sim/model";
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

  it("lands on the cheapest tier when the chosen tier is removed from the candidate", () => {
    // Express order; candidate drops express entirely -> falls to standard.
    const candidate: Scheme = {
      standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 },
    };
    const prepared = prepareBuckets(bucketOrders([o(150, "express")]), current);
    const r = behavioralScenario(prepared, candidate, ZERO);
    expect(r.shippingRevenue).toBe(0); // 150 >= 100 -> free standard
    expect(r.carrierSpend).toBe(7); // standard carrier cost, not express
  });

  it("does not abandon when the landed fee equals the current fee", () => {
    // Same fee as today -> not worse off -> abandonment must not apply (strict >).
    const stdOnly: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 } };
    const prepared = prepareBuckets(bucketOrders([o(80, "standard")]), stdOnly);
    const r = behavioralScenario(prepared, stdOnly, {
      cogsPercent: 0.5,
      upliftRate: 0,
      upliftWindow: 20,
      abandonRate: 1,
    });
    expect(r.expectedOrdersLost).toBe(0);
    expect(r.shippingRevenue).toBe(10);
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

describe("thresholdCandidates", () => {
  it("sweeps $0 to max(400, p95 rounded up to $10) in $10 steps, with null last", () => {
    const small = thresholdCandidates([o(50, "standard")]);
    expect(small[0]).toBe(0);
    expect(small[small.length - 1]).toBeNull();
    expect(small[small.length - 2]).toBe(400);
    expect(small).toContain(150); // $10 steps

    const big = thresholdCandidates(Array.from({ length: 20 }, () => o(950, "standard")));
    expect(big[big.length - 2]).toBe(950); // ceil(950/10)*10, above the 400 floor
  });

  it("caps the sweep at $1000", () => {
    const huge = thresholdCandidates(Array.from({ length: 20 }, () => o(5000, "standard")));
    expect(huge[huge.length - 2]).toBe(1000);
  });
});

describe("recommendOptions", () => {
  const behavior: BehaviorParams = {
    cogsPercent: 0.4,
    upliftRate: 0.3,
    upliftWindow: 20,
    abandonRate: 0,
  };

  it("returns [] when the current scheme has no standard tier", () => {
    const expressOnly: Scheme = {
      express: { tier: "express", fee: 15, freeThreshold: 200, avgCost: 12 },
    };
    expect(recommendOptions([o(80, "express")], expressOnly, behavior)).toEqual([]);
  });

  it("returns [] when there are no analysable orders", () => {
    expect(recommendOptions([], current, behavior)).toEqual([]);
  });

  it("profit-first matches a brute-force sweep of the same candidates (behaviour zeroed)", () => {
    const orders = [
      o(80, "standard"),
      o(150, "standard"),
      o(150, "express"),
      o(250, "express"),
      o(60, "standard"),
    ];
    const baseline = currentScenario(orders, current).netShippingProfit;
    let bestDelta = -Infinity;
    for (const t of thresholdCandidates(orders)) {
      const cand: Scheme = {
        ...current,
        standard: { ...current.standard!, freeThreshold: t },
      };
      const delta = proposedScenario(orders, current, cand).netShippingProfit - baseline;
      if (delta > bestDelta) bestDelta = delta;
    }
    const a = recommendOptions(orders, current, behavior).find((r) => r.id === "profit-first")!;
    // abandonRate 0 and uplift forced off for profit-first -> contribution = shipping delta
    expect(a.contributionDelta).toBeCloseTo(bestDelta);
    expect(a.upliftMarginGain).toBe(0);
  });

  it("computes the three cards on a single-tier fixture (hand-verified)", () => {
    // Current: std fee $10, free over $200, cost $7. One order, gross $185 (pays $10 today).
    const cur: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 200, avgCost: 7 } };
    const b: BehaviorParams = { cogsPercent: 0.2, upliftRate: 1, upliftWindow: 20, abandonRate: 0 };
    const recs = recommendOptions([o(185, "standard")], cur, b);
    const a = recs.find((r) => r.id === "profit-first")!;
    const tf = recs.find((r) => r.id === "threshold-fee")!;
    const bb = recs.find((r) => r.id === "basket-builder")!;

    // A (uplift off): any T <= 180 makes the order free (delta -10); T >= 190 keeps it
    // paying (delta 0). Ties prefer the lowest threshold -> 190. Charges everyone ->
    // unconstrained flag (abandonment 0).
    expect(a.threshold).toBe(190);
    expect(a.contributionDelta).toBeCloseTo(0);
    expect(a.unconstrained).toBe(true);

    // B: with no abandonment, revenue is monotone in fee -> pins at maxFee = max(2*10, 30) = 30.
    expect(tf.fee).toBe(30);
    expect(tf.threshold).toBe(190);
    expect(tf.contributionDelta).toBeCloseTo(20); // (30-7) - (10-7)
    expect(tf.unconstrained).toBe(true);

    // C (uplift on): at T=200 the order (in window [180,200)) builds: loses the $10 fee,
    // gains (200-185)*0.8 = $12 margin -> delta +2. Beats every paying candidate (0).
    expect(bb.threshold).toBe(200);
    expect(bb.contributionDelta).toBeCloseTo(2);
    expect(bb.upliftMarginGain).toBeCloseTo(12);
    expect(bb.unconstrained).toBe(false); // optimum is interior, threshold gives free shipping
  });

  it("does not flag unconstrained when abandonment is set", () => {
    const orders = [o(80, "standard"), o(150, "standard"), o(170, "standard")];
    const cur: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 } };
    const withAbandon: BehaviorParams = {
      cogsPercent: 0.5,
      upliftRate: 0,
      upliftWindow: 20,
      abandonRate: 0.5,
    };
    const a = recommendOptions(orders, cur, withAbandon).find((r) => r.id === "profit-first")!;
    expect(a.unconstrained).toBe(false);
    // T=100 (the current scheme) is always a candidate, so the optimum is never negative.
    expect(a.contributionDelta).toBeGreaterThanOrEqual(0);
  });

  it("flags unconstrained when the basket-builder optimum pins at the sweep cap", () => {
    // Order at $995 with a tiny $2 fee: building to T=1000 gains (1000-995)*0.8 = $4
    // of margin vs $2 of fee revenue under flat — so C pins at the $1000 cap. The
    // ideal threshold lies beyond the cap, so the optimum must be flagged.
    const cur: Scheme = { standard: { tier: "standard", fee: 2, freeThreshold: 100, avgCost: 3 } };
    const b: BehaviorParams = { cogsPercent: 0.2, upliftRate: 1, upliftWindow: 20, abandonRate: 0 };
    const recs = recommendOptions(Array.from({ length: 20 }, () => o(995, "standard")), cur, b);
    const bb = recs.find((r) => r.id === "basket-builder")!;
    expect(bb.threshold).toBe(1000);
    expect(bb.unconstrained).toBe(true);
  });

  it("rounds the fee sweep ceiling up so the fee-pin guard works for non-integer fees", () => {
    // std fee 16.55 -> ceiling ceil(33.1) = 34. With abandonment 0, revenue is
    // monotone in fee, so threshold-fee pins at 34 and must be flagged.
    const cur: Scheme = { standard: { tier: "standard", fee: 16.55, freeThreshold: 100, avgCost: 7 } };
    const noAbandon: BehaviorParams = { cogsPercent: 0.5, upliftRate: 0, upliftWindow: 20, abandonRate: 0 };
    const tf = recommendOptions([o(80, "standard")], cur, noAbandon).find((r) => r.id === "threshold-fee")!;
    expect(tf.fee).toBe(34);
    expect(tf.unconstrained).toBe(true);
  });

  it("excludes orders whose tier is not in the current scheme", () => {
    const stdOnly: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 } };
    const withStray = recommendOptions(
      [o(80, "standard"), o(120, "nextday" as CanonicalTier)],
      stdOnly,
      behavior
    );
    const without = recommendOptions([o(80, "standard")], stdOnly, behavior);
    expect(withStray).toEqual(without);
  });

  it("returns zero deltas without crashing when every order ships free under every candidate", () => {
    // Fee 0 everywhere -> every candidate is free for everyone -> all deltas 0.
    const freeScheme: Scheme = { standard: { tier: "standard", fee: 0, freeThreshold: null, avgCost: 7 } };
    const a = recommendOptions([o(80, "standard")], freeScheme, behavior).find(
      (r) => r.id === "profit-first"
    )!;
    expect(a.contributionDelta).toBe(0);
    expect(a.netShippingProfitDelta).toBe(0);
  });
});
