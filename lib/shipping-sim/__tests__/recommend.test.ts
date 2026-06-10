import { describe, it, expect } from "vitest";
import { bucketOrders, prepareBuckets, behavioralScenario, recommendOptions, thresholdCandidates, evaluateScheme, thresholdCurves } from "@/lib/shipping-sim/recommend";
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
    // gross 90, candidate fee 10 / free over 100, window 20 -> in window [80, 100).
    // Current = FLAT (no threshold): the window is NEW, so uplift applies.
    // uplift 0.5: half build (free, margin gain (100-90)*0.6), half pay $10. Not worse off -> no abandonment.
    const flatCurrent: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: null, avgCost: 7 } };
    const candidate: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 } };
    const prepared = prepareBuckets(bucketOrders([o(90, "standard")]), flatCurrent);
    const r = behavioralScenario(prepared, candidate, {
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
    // Current = FLAT (no threshold): the window is NEW, so uplift applies.
    // Increase = 20 - 10 = $10; abandonProb = min(1, 0.5 * (10/10)) = 0.5.
    // uplift 0.4 builds; of remaining 0.6, abandon 0.5 -> 0.3 abandons, 0.3 pays.
    const flatCurrent: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: null, avgCost: 7 } };
    const candidate: Scheme = { standard: { tier: "standard", fee: 20, freeThreshold: 100, avgCost: 7 } };
    const prepared = prepareBuckets(bucketOrders([o(85, "standard")]), flatCurrent);
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

  it("does not apply uplift to windows the customer already declined under the current scheme", () => {
    // gross 90 is in the $20 window below the CURRENT $100 threshold — the data already
    // shows this customer didn't build. Candidate = same scheme -> no uplift.
    const stdOnly: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 } };
    const r = behavioralScenario(prepareBuckets(bucketOrders([o(90, "standard")]), stdOnly), stdOnly, {
      cogsPercent: 0.4, upliftRate: 0.5, upliftWindow: 20, abandonRate: 0,
    });
    expect(r.upliftMarginGain).toBe(0);
    expect(r.impact.builders).toBe(0);
    expect(r.shippingRevenue).toBeCloseTo(10); // pays as observed
  });

  it("scales abandonment with the size of the increase ($10 units, capped at 1)", () => {
    const stdOnly: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 } };
    // $30 increase (fee 40 vs 10) at rate 0.1 -> probability 0.3
    const fee40: Scheme = { standard: { tier: "standard", fee: 40, freeThreshold: 100, avgCost: 7 } };
    const r30 = behavioralScenario(prepareBuckets(bucketOrders([o(80, "standard")]), stdOnly), fee40, {
      cogsPercent: 0.5, upliftRate: 0, upliftWindow: 20, abandonRate: 0.1,
    });
    expect(r30.expectedOrdersLost).toBeCloseTo(0.3);
    expect(r30.shippingRevenue).toBeCloseTo(0.7 * 40);

    // $5 increase (fee 15 vs 10) at rate 0.1 -> probability 0.05
    const fee15: Scheme = { standard: { tier: "standard", fee: 15, freeThreshold: 100, avgCost: 7 } };
    const r5 = behavioralScenario(prepareBuckets(bucketOrders([o(80, "standard")]), stdOnly), fee15, {
      cogsPercent: 0.5, upliftRate: 0, upliftWindow: 20, abandonRate: 0.1,
    });
    expect(r5.expectedOrdersLost).toBeCloseTo(0.05);

    // $200 increase at rate 0.1 -> capped at 1 (all abandon)
    const fee210: Scheme = { standard: { tier: "standard", fee: 210, freeThreshold: 100, avgCost: 7 } };
    const rCap = behavioralScenario(prepareBuckets(bucketOrders([o(80, "standard")]), stdOnly), fee210, {
      cogsPercent: 0.5, upliftRate: 0, upliftWindow: 20, abandonRate: 0.1,
    });
    expect(rCap.expectedOrdersLost).toBeCloseTo(1);
    expect(rCap.shippingRevenue).toBe(0);
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
    // Current: std fee $10, FLAT (no threshold), cost $7. One order, gross $185 (pays $10 today).
    // Baseline net = 10 - 7 = 3.
    const cur: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: null, avgCost: 7 } };
    const b: BehaviorParams = { cogsPercent: 0.2, upliftRate: 1, upliftWindow: 20, abandonRate: 0 };
    const recs = recommendOptions([o(185, "standard")], cur, b);
    const a = recs.find((r) => r.id === "profit-first")!;
    const tf = recs.find((r) => r.id === "threshold-fee")!;
    const bb = recs.find((r) => r.id === "basket-builder")!;

    // A (uplift off): any T <= 185 makes the order free (revenue 0, delta (0-7)-3 = -10);
    // T = 190 keeps it paying (pays 10, delta (10-7)-3 = 0). Ties prefer lowest threshold
    // -> 190. freeOrderShare=0 -> unconstrained flag (abandonment 0, charges everyone).
    expect(a.threshold).toBe(190);
    expect(a.contributionDelta).toBeCloseTo(0);
    expect(a.unconstrained).toBe(true);

    // B: with no abandonment, revenue is monotone in fee -> pins at maxFee = max(2*10,30) = 30.
    // At fee=30, T=190: pays 30, delta = (30-7)-3 = 20. unconstrained (fee=maxFee, abandon=0).
    expect(tf.fee).toBe(30);
    expect(tf.threshold).toBe(190);
    expect(tf.contributionDelta).toBeCloseTo(20); // (30-7) - (10-7)
    expect(tf.unconstrained).toBe(true);
    expect(tf.capPinned).toBe(true); // fee === maxFee

    // C (uplift on): current is FLAT so any candidate threshold creates a NEW window.
    // At T=200: order in window [180,200), buildWeight=1 (upliftRate=1), alreadyInWindow=false.
    //   shippingRevenue=0, carrierSpend=7, upliftMarginGain=(200-185)*0.8=12
    //   delta = (0-7)-3 + 12 = +2. Beats every paying candidate (delta 0).
    // freeOrderShare=1 (builder ships free) -> unconstrained=false (interior optimum).
    expect(bb.threshold).toBe(200);
    expect(bb.contributionDelta).toBeCloseTo(2);
    expect(bb.upliftMarginGain).toBeCloseTo(12);
    expect(bb.unconstrained).toBe(false);
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

  it("sets capPinned=true when the fee optimum pins at the fee cap with non-zero abandonment", () => {
    // Current: std fee $30, free over $250, cost $7.
    // Five orders at gross [100, 120, 140, 160, 180] — all below T=250, all paying $30 today.
    // behavior: cogsPercent 0.3, upliftRate 0, upliftWindow 20, abandonRate 0.01.
    // maxFee = ceil(max(2*30, 30)) = 60.
    //
    // Working at fee=60, Δ=30, abandonProb = 0.01*(30/10) = 0.03:
    //   shippingRevenue  = 5 × 0.97 × 60 = 291
    //   carrierSpend     = 5 × 0.97 × 7  = 33.95
    //   netShippingProfit = 257.05; baseline = 5×(30-7) = 115
    //   abandonMarginLoss = 0.03 × 0.7 × 700 = 14.7
    //   contributionDelta = 257.05 - 115 - 14.7 = 127.35
    //
    // At fee=59, Δ=29, abandonProb=0.029:
    //   contributionDelta ≈ 123.25  →  fee=60 strictly better → optimum pins at cap.
    //
    // Since abandonRate > 0: unconstrained=false, but capPinned=true (fee===maxFee).
    const cur: Scheme = {
      standard: { tier: "standard", fee: 30, freeThreshold: 250, avgCost: 7 },
    };
    const b: BehaviorParams = {
      cogsPercent: 0.3,
      upliftRate: 0,
      upliftWindow: 20,
      abandonRate: 0.01,
    };
    const orders = [
      o(100, "standard"),
      o(120, "standard"),
      o(140, "standard"),
      o(160, "standard"),
      o(180, "standard"),
    ];
    const tf = recommendOptions(orders, cur, b).find((r) => r.id === "threshold-fee")!;
    expect(tf.fee).toBe(60); // pins at the cap
    expect(tf.unconstrained).toBe(false); // abandonRate > 0 → not unconstrained
    expect(tf.capPinned).toBe(true); // fee === maxFee → true optimum may lie beyond
  });

  it("sets capPinned=false for the hand-verified single-tier case (interior optimum)", () => {
    // Reuse the updated single-tier fixture: FLAT current, candidate T=200, fee=10.
    // The basket-builder optimum lands at T=200 (interior, well below maxThreshold=400)
    // with fee=10 (unchanged). capPinned must be false.
    const cur: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: null, avgCost: 7 } };
    const b: BehaviorParams = { cogsPercent: 0.2, upliftRate: 1, upliftWindow: 20, abandonRate: 0 };
    const recs = recommendOptions([o(185, "standard")], cur, b);
    const bb = recs.find((r) => r.id === "basket-builder")!;
    expect(bb.threshold).toBe(200);
    expect(bb.capPinned).toBe(false); // threshold 200 < maxThreshold 400
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

describe("evaluateScheme", () => {
  const behavior: BehaviorParams = { cogsPercent: 0.4, upliftRate: 0, upliftWindow: 20, abandonRate: 0.1 };

  it("returns null when there are no analysable orders", () => {
    expect(evaluateScheme([], current, current, behavior)).toBeNull();
    expect(evaluateScheme([o(80, "nextday")], current, current, behavior)).toBeNull();
  });

  it("evaluating the current scheme against itself yields zero deltas", () => {
    const orders = [o(80, "standard"), o(150, "standard"), o(150, "express")];
    const e = evaluateScheme(orders, current, current, behavior)!;
    expect(e.contributionDelta).toBeCloseTo(0);
    expect(e.netShippingProfitDelta).toBeCloseTo(0);
    // uplift is 0 because upliftRate is 0
    expect(e.upliftMarginGain).toBe(0);
    // abandonment is 0 because no order is worse off vs current
    expect(e.abandonMarginLoss).toBe(0);
    expect(e.expectedOrdersLost).toBe(0);
    expect(e.orderCount).toBe(3);
  });

  it("evaluating the current scheme against itself is a strict no-op even with full behaviour", () => {
    const orders = [o(80, "standard"), o(90, "standard"), o(150, "standard"), o(150, "express")];
    const full: BehaviorParams = { cogsPercent: 0.4, upliftRate: 0.5, upliftWindow: 20, abandonRate: 0.3 };
    const e = evaluateScheme(orders, current, current, full)!;
    expect(e.contributionDelta).toBe(0);
    expect(e.netShippingProfitDelta).toBe(0);
    expect(e.upliftMarginGain).toBe(0);
    expect(e.abandonMarginLoss).toBe(0);
    expect(e.expectedOrdersLost).toBe(0);
  });

  it("matches the recommendOptions metrics for the same candidate scheme", () => {
    const orders = [
      o(80, "standard"),
      o(150, "standard"),
      o(150, "express"),
      o(250, "express"),
      o(60, "standard"),
    ];
    const b: BehaviorParams = { cogsPercent: 0.4, upliftRate: 0.3, upliftWindow: 20, abandonRate: 0.1 };
    const bb = recommendOptions(orders, current, b).find((r) => r.id === "basket-builder")!;
    const candidate: Scheme = {
      ...current,
      standard: { ...current.standard!, fee: bb.fee, freeThreshold: bb.threshold },
    };
    const e = evaluateScheme(orders, current, candidate, b)!;
    expect(e.contributionDelta).toBeCloseTo(bb.contributionDelta);
    expect(e.netShippingProfitDelta).toBeCloseTo(bb.netShippingProfitDelta);
    expect(e.upliftMarginGain).toBeCloseTo(bb.upliftMarginGain);
    expect(e.abandonMarginLoss).toBeCloseTo(bb.abandonMarginLoss);
    expect(e.expectedOrdersLost).toBeCloseTo(bb.expectedOrdersLost);
    expect(e.freeOrderShare).toBeCloseTo(bb.freeOrderShare);
    expect(e.recoveryRate).toBeCloseTo(bb.recoveryRate);
  });

  it("exposes EV absolutes and impact counts", () => {
    const orders = [o(80, "standard"), o(150, "standard")];
    const e = evaluateScheme(orders, current, current, ZERO)!;
    expect(e.shippingRevenue).toBeCloseTo(10); // 80 pays 10, 150 free
    expect(e.carrierSpend).toBeCloseTo(14);
    expect(e.netShippingProfit).toBeCloseTo(e.shippingRevenue - e.carrierSpend);
    expect(e.impact).toEqual({ newlyPaying: 0, newlyFree: 0, builders: 0, switchedTier: 0 });
  });

  it("exposes per-tier volume and spend", () => {
    const e = evaluateScheme([o(80, "standard"), o(150, "express")], current, current, ZERO)!;
    expect(e.volumeByTier).toEqual({ standard: 1, express: 1, nextday: 0, sameday: 0 });
    expect(e.carrierSpendByTier.standard).toBeCloseTo(7);
    expect(e.carrierSpendByTier.express).toBeCloseTo(12);
  });
});

describe("behavioralScenario volumeByTier and carrierSpendByTier", () => {
  it("tracks per-tier volume and carrier spend including switches", () => {
    // Express order switches to standard when express is dropped: volume lands on standard.
    const candidate: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 } };
    const r = behavioralScenario(prepareBuckets(bucketOrders([o(150, "express"), o(80, "standard")]), current), candidate, ZERO);
    expect(r.volumeByTier.standard).toBeCloseTo(2);
    expect(r.volumeByTier.express).toBe(0);
    expect(r.carrierSpendByTier.standard).toBeCloseTo(14);
    expect(r.carrierSpendByTier.express).toBe(0);
  });
});

describe("behavioralScenario impact counts", () => {
  it("counts newly-paying orders (free under current, paying under candidate)", () => {
    // gross 150: free under current std T100; candidate raises T to 200 -> pays $10. abandon 0.2.
    const stdOnly: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 } };
    const candidate: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 200, avgCost: 7 } };
    const prepared = prepareBuckets(bucketOrders([o(150, "standard")]), stdOnly);
    const r = behavioralScenario(prepared, candidate, { cogsPercent: 0.5, upliftRate: 0, upliftWindow: 20, abandonRate: 0.2 });
    expect(r.impact.newlyPaying).toBeCloseTo(0.8); // 0.2 abandoned, 0.8 pay
    expect(r.impact.newlyFree).toBe(0);
    expect(r.impact.builders).toBe(0);
    expect(r.impact.switchedTier).toBe(0);
  });

  it("counts newly-free orders and builders separately", () => {
    // gross 80 pays $10 under current; candidate lowers T to 50 -> ships free: newlyFree 1.
    const stdOnly: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 } };
    const lowT: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 50, avgCost: 7 } };
    const free = behavioralScenario(prepareBuckets(bucketOrders([o(80, "standard")]), stdOnly), lowT, ZERO);
    expect(free.impact.newlyFree).toBe(1);
    expect(free.impact.builders).toBe(0);

    // gross 90, current = FLAT (no threshold), candidate T=100: window is NEW -> builders 0.5.
    // currentFee=10, landedFee=10, no abandonment; half build free, half pay $10 -> newlyFree 0.
    const flatCurrent: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: null, avgCost: 7 } };
    const candT100: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 } };
    const r = behavioralScenario(prepareBuckets(bucketOrders([o(90, "standard")]), flatCurrent), candT100, {
      cogsPercent: 0.4, upliftRate: 0.5, upliftWindow: 20, abandonRate: 0,
    });
    expect(r.impact.builders).toBeCloseTo(0.5);
    expect(r.impact.newlyFree).toBe(0);
    expect(r.impact.newlyPaying).toBe(0);
  });

  it("counts tier switches", () => {
    // Express order, candidate drops express -> lands standard (free at 150): switchedTier 1.
    const candidate: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 } };
    const r = behavioralScenario(prepareBuckets(bucketOrders([o(150, "express")]), current), candidate, ZERO);
    expect(r.impact.switchedTier).toBe(1);
    // Under current, express at gross 150 < 200 -> fee 15 > 0; candidate standard free at 150 -> landedFee 0 -> newlyFree 1.
    expect(r.impact.newlyFree).toBe(1);
  });
});

describe("thresholdCurves", () => {
  it("returns one point per numeric threshold candidate and zero delta at the current threshold", () => {
    const orders = [o(80, "standard"), o(150, "standard")];
    const b: BehaviorParams = { cogsPercent: 0.4, upliftRate: 0.3, upliftWindow: 20, abandonRate: 0.1 };
    const curves = thresholdCurves(orders, current, b);
    const numeric = thresholdCandidates(orders).filter((t) => t !== null);
    expect(curves).toHaveLength(numeric.length);
    // At the current threshold (100) with uplift OFF, the candidate equals the current scheme -> delta 0.
    const at100 = curves.find((p) => p.threshold === 100)!;
    expect(at100.contributionNoUplift).toBeCloseTo(0);
  });

  it("matches evaluateScheme at the same candidate", () => {
    const orders = [o(80, "standard"), o(150, "standard"), o(150, "express")];
    const b: BehaviorParams = { cogsPercent: 0.4, upliftRate: 0.5, upliftWindow: 20, abandonRate: 0.1 };
    const curves = thresholdCurves(orders, current, b);
    const at200 = curves.find((p) => p.threshold === 200)!;
    const candidate: Scheme = { ...current, standard: { ...current.standard!, freeThreshold: 200 } };
    expect(at200.contributionWithUplift).toBeCloseTo(evaluateScheme(orders, current, candidate, b)!.contributionDelta);
  });

  it("returns [] without a standard tier or analysable orders", () => {
    expect(thresholdCurves([], current, ZERO)).toEqual([]);
    const expressOnly: Scheme = { express: { tier: "express", fee: 15, freeThreshold: 200, avgCost: 12 } };
    expect(thresholdCurves([o(80, "express")], expressOnly, ZERO)).toEqual([]);
  });
});
