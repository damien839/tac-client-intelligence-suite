import { describe, it, expect } from "vitest";
import { bucketOrders, dominantPaidTier, prepareBuckets, behavioralScenario, recommendOptions, thresholdCandidates, evaluateScheme, thresholdCurves } from "@/lib/shipping-sim/recommend";
import { proposedScenario } from "@/lib/shipping-sim/model";
import {
  BehaviorParams,
  CANONICAL_TIERS,
  CanonicalTier,
  RecommendedScheme,
  Scheme,
  TaggedOrder,
  UnitStats,
} from "@/lib/shipping-sim/types";

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

describe("dominantPaidTier", () => {
  it("picks the tier with the most paying orders", () => {
    // standard fee 10 free over 100; express fee 15 free over 200.
    // standard: o(80) pays $10, o(90) pays $10 → 2 paying; o(150,200,300,400,500) free → 5 free; total paid = 2.
    // express: o(100) pays $15, o(120) pays $15, o(140) pays $15 → 3 paying (all below 200); total paid = 3.
    const orders = [
      ...[80, 90].map((g) => o(g, "standard")), // pay
      ...[150, 200, 300, 400, 500].map((g) => o(g, "standard")), // free over 100
      ...[100, 120, 140].map((g) => o(g, "express")), // pay (free over 200)
    ];
    expect(dominantPaidTier(orders, current)).toBe("express");
  });

  it("falls back to total volume when nobody pays, then canonical order", () => {
    const freeScheme: Scheme = {
      standard: { tier: "standard", fee: 0, freeThreshold: null, avgCost: 7 },
      express: { tier: "express", fee: 0, freeThreshold: null, avgCost: 12 },
    };
    // No paid orders; express has 2 total vs standard 1: falls back to total → express.
    const orders = [o(100, "express"), o(120, "express"), o(80, "standard")];
    expect(dominantPaidTier(orders, freeScheme)).toBe("express");
    // Empty orders → null.
    expect(dominantPaidTier([], current)).toBeNull();
  });
});

describe("recommendOptions", () => {
  const behavior: BehaviorParams = {
    cogsPercent: 0.4,
    upliftRate: 0.3,
    upliftWindow: 20,
    abandonRate: 0.1,
  };

  /** Every changed tier's config differs from current; every unchanged tier's matches. */
  function expectChangedTiersConsistent(rec: RecommendedScheme, cur: Scheme) {
    for (const tier of CANONICAL_TIERS) {
      const a = cur[tier];
      const b = rec.scheme[tier];
      if (!a && !b) {
        expect(rec.changedTiers).not.toContain(tier);
        continue;
      }
      const differs = !a || !b || a.fee !== b.fee || a.freeThreshold !== b.freeThreshold;
      expect(rec.changedTiers.includes(tier)).toBe(differs);
    }
  }

  // Two-tier fixture where shifting freight pays: express loses $18/order today
  // (fee $12, carrier cost $30) while standard makes $5 — pushing express volume
  // onto standard is the profitable move the multi-tier sweep must find.
  const shiftCurrent: Scheme = {
    standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 5 },
    express: { tier: "express", fee: 12, freeThreshold: null, avgCost: 30 },
  };
  const shiftOrders: TaggedOrder[] = [
    o(50, "standard"),
    o(50, "standard"),
    ...Array.from({ length: 20 }, () => o(80, "express")),
  ];
  const shiftBehavior: BehaviorParams = {
    cogsPercent: 0.3,
    upliftRate: 0.3,
    upliftWindow: 20,
    abandonRate: 0.1,
  };

  it("returns exactly [net-profit, basket-builder] with consistent changedTiers", () => {
    const recs = recommendOptions(shiftOrders, shiftCurrent, shiftBehavior, null);
    expect(recs.map((r) => r.id)).toEqual(["net-profit", "basket-builder"]);
    expect(recs[0].label).toBe("Net profit maximiser");
    expect(recs[1].label).toBe("Basket-builder");
    for (const rec of recs) expectChangedTiersConsistent(rec, shiftCurrent);
  });

  it("returns [] when there are no analysable orders", () => {
    expect(recommendOptions([], current, behavior, null)).toEqual([]);
  });

  it("net-profit re-prices express and shifts freight onto standard when that pays", () => {
    const np = recommendOptions(shiftOrders, shiftCurrent, shiftBehavior, null).find(
      (r) => r.id === "net-profit"
    )!;
    expect(np.changedTiers).toContain("express");
    // Hand-verified floor: expFee 14 alone moves all 20 express orders to standard
    // (revealed premium $2 < stay premium $4); each goes from -$18 to +$5 net with no
    // abandonment (landed fee $10 < current $12) -> +$460. The sweep must do at least
    // that well (that candidate is on the coarse grid).
    expect(np.contributionDelta).toBeGreaterThanOrEqual(460 - 1e-9);
    // Metrics agree with evaluateScheme on the winning scheme (uplift forced off).
    const ev = evaluateScheme(shiftOrders, shiftCurrent, np.scheme, {
      ...shiftBehavior,
      upliftRate: 0,
    })!;
    expect(ev.contributionDelta).toBeCloseTo(np.contributionDelta);
    expect(ev.netShippingProfitDelta).toBeCloseTo(np.netShippingProfitDelta);
    // Freight shift is visible: more volume lands on standard than the current 2 orders.
    const currentFacts = evaluateScheme(shiftOrders, shiftCurrent, shiftCurrent, {
      ...shiftBehavior,
      upliftRate: 0,
    })!;
    expect(currentFacts.volumeByTier.standard).toBeCloseTo(2);
    expect(ev.volumeByTier.standard).toBeGreaterThan(currentFacts.volumeByTier.standard);
  });

  it("net-profit winner beats every sampled coarse candidate (refine-pass sanity)", () => {
    const np = recommendOptions(shiftOrders, shiftCurrent, shiftBehavior, null).find(
      (r) => r.id === "net-profit"
    )!;
    const noUplift = { ...shiftBehavior, upliftRate: 0 };
    const sample = (
      std: { fee: number; t: number | null },
      exp: { fee: number; t: number | null }
    ): number =>
      evaluateScheme(
        shiftOrders,
        shiftCurrent,
        {
          standard: { ...shiftCurrent.standard!, fee: std.fee, freeThreshold: std.t },
          express: { ...shiftCurrent.express!, fee: exp.fee, freeThreshold: exp.t },
        },
        noUplift
      )!.contributionDelta;
    const samples = [
      sample({ fee: 10, t: 100 }, { fee: 12, t: null }), // current
      sample({ fee: 10, t: 100 }, { fee: 20, t: null }),
      sample({ fee: 30, t: 100 }, { fee: 30, t: null }),
      sample({ fee: 10, t: null }, { fee: 12, t: null }),
      sample({ fee: 20, t: 200 }, { fee: 24, t: null }),
      sample({ fee: 0, t: 0 }, { fee: 0, t: null }),
    ];
    for (const delta of samples) {
      expect(np.contributionDelta).toBeGreaterThanOrEqual(delta - 1e-9);
    }
  });

  // Damo-shaped book: std $30 free over $250 (cost $25); express $60 flat (cost $55);
  // 12 free standard orders 260..700, 3 paying standard, 45 express 110..594.
  const damoCurrent: Scheme = {
    standard: { tier: "standard", fee: 30, freeThreshold: 250, avgCost: 25 },
    express: { tier: "express", fee: 60, freeThreshold: null, avgCost: 55 },
  };
  const damoOrders: TaggedOrder[] = [
    ...Array.from({ length: 12 }, (_, i) => o(260 + i * 40, "standard")), // free std
    o(80, "standard"),
    o(140, "standard"),
    o(200, "standard"), // paying std
    ...Array.from({ length: 45 }, (_, i) => o(110 + i * 11, "express")), // pay $60 flat
  ];
  const damoBehavior: BehaviorParams = {
    cogsPercent: 0.3,
    upliftRate: 0.3,
    upliftWindow: 20,
    abandonRate: 0.1,
  };
  const damoUnits: UnitStats = {
    typicalUnitPrice: 45,
    ordersWithUnits: 60,
    unitShare: { single: 0.4, double: 0.35, threePlus: 0.25 },
  };

  it("finds the profitable express->standard freight shift on the Damo-shaped book", () => {
    const recs = recommendOptions(damoOrders, damoCurrent, damoBehavior, damoUnits);
    expect(recs.map((r) => r.id)).toEqual(["net-profit", "basket-builder"]);
    const [np, bb] = recs;
    // Computed optimum (verified independently via evaluateScheme): price express off
    // the menu (expFee pins at the $120 cap) and capture its volume on standard at a
    // fee just below the current $60 express fee — switchers are better off (no
    // abandonment) while per-order margin jumps from $5 to ~$34, net of the free-band
    // losses the higher standard threshold creates. Both paid tiers change.
    expect(np.contributionDelta).toBeGreaterThan(0);
    expect(np.changedTiers).toContain("express");
    for (const t of np.changedTiers) expect(["standard", "express"]).toContain(t);
    // The fee cap binds, and the guard says so.
    expect(np.capPinned).toBe(true);
    expect(np.unconstrained).toBe(false); // abandonment is live
    // Metrics agree with an independent evaluation of the winning scheme.
    const noUpliftCheck = { ...damoBehavior, upliftRate: 0 };
    const ev = evaluateScheme(damoOrders, damoCurrent, np.scheme, noUpliftCheck)!;
    expect(ev.contributionDelta).toBeCloseTo(np.contributionDelta);
    // Freight-shift accounting is visible: express volume moves onto standard.
    const currentFacts = evaluateScheme(damoOrders, damoCurrent, damoCurrent, noUpliftCheck)!;
    expect(currentFacts.volumeByTier.standard).toBeCloseTo(15); // 12 free + 3 paying
    expect(ev.volumeByTier.standard).toBeGreaterThan(currentFacts.volumeByTier.standard);
    expect(ev.volumeByTier.express).toBeLessThan(currentFacts.volumeByTier.express);
    // The winner beats hand-picked aggressive candidates.
    const noUplift = { ...damoBehavior, upliftRate: 0 };
    const probe = (
      std: { fee: number; t: number | null },
      exp: { fee: number; t: number | null }
    ): number =>
      evaluateScheme(
        damoOrders,
        damoCurrent,
        {
          standard: { ...damoCurrent.standard!, fee: std.fee, freeThreshold: std.t },
          express: { ...damoCurrent.express!, fee: exp.fee, freeThreshold: exp.t },
        },
        noUplift
      )!.contributionDelta;
    const probes = [
      probe({ fee: 30, t: 250 }, { fee: 60, t: null }), // current -> 0
      probe({ fee: 40, t: 250 }, { fee: 60, t: null }),
      probe({ fee: 48, t: 250 }, { fee: 80, t: null }),
      probe({ fee: 30, t: 600 }, { fee: 60, t: null }),
      probe({ fee: 30, t: null }, { fee: 60, t: null }),
      probe({ fee: 30, t: 250 }, { fee: 60, t: 215 }),
      probe({ fee: 30, t: 250 }, { fee: 58, t: null }),
      probe({ fee: 58, t: 540 }, { fee: 120, t: null }), // near the computed optimum
    ];
    for (const delta of probes) {
      expect(np.contributionDelta).toBeGreaterThanOrEqual(delta - 1e-9);
    }
    // No dense $10-bin cluster exists in this book (all bins hold <3 orders), so the
    // unit-driven basket sweep has no candidates: keep current, no narrative.
    expect(bb.changedTiers).toEqual([]);
    expect(bb.contributionDelta).toBeCloseTo(0);
    expect(bb.basketNarrative).toBeUndefined();
  });

  it("single-used-tier data degrades net-profit to the old 2D threshold x fee sweep (hand-verified)", () => {
    // Current: std fee $10, FLAT, cost $7. One order, gross $185 (pays $10 today).
    // Baseline net = 10 - 7 = 3. With no abandonment revenue is monotone in fee ->
    // pins at maxFee = max(2*10, 30) = 30. At fee=30, T=190 keeps the order paying:
    // delta (30-7)-3 = 20. Fee-major grid + strict > -> lowest fee then lowest
    // threshold among ties -> fee 30, T 190. unconstrained (abandon 0) + capPinned.
    const cur: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: null, avgCost: 7 } };
    const b: BehaviorParams = { cogsPercent: 0.2, upliftRate: 1, upliftWindow: 20, abandonRate: 0 };
    const np = recommendOptions([o(185, "standard")], cur, b, null).find(
      (r) => r.id === "net-profit"
    )!;
    expect(np.scheme.standard!.fee).toBe(30);
    expect(np.scheme.standard!.freeThreshold).toBe(190);
    expect(np.changedTiers).toEqual(["standard"]);
    expect(np.contributionDelta).toBeCloseTo(20);
    expect(np.upliftMarginGain).toBe(0); // uplift forced off
    expect(np.unconstrained).toBe(true);
    expect(np.capPinned).toBe(true);
  });

  it("basket-builder without unitStats runs the slider sweep on the dominant tier (hand-verified)", () => {
    // Same fixture, uplift on (rate 1, window $20): at T=200 the $185 order builds —
    // ships free, gains (200-185)*0.8 = $12 margin; delta = (0-7)-3+12 = +2. Beats
    // every paying candidate (delta 0). Fee stays at current ($10). No narrative.
    const cur: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: null, avgCost: 7 } };
    const b: BehaviorParams = { cogsPercent: 0.2, upliftRate: 1, upliftWindow: 20, abandonRate: 0 };
    const bb = recommendOptions([o(185, "standard")], cur, b, null).find(
      (r) => r.id === "basket-builder"
    )!;
    expect(bb.scheme.standard!.fee).toBe(10);
    expect(bb.scheme.standard!.freeThreshold).toBe(200);
    expect(bb.changedTiers).toEqual(["standard"]);
    expect(bb.contributionDelta).toBeCloseTo(2);
    expect(bb.upliftMarginGain).toBeCloseTo(12);
    expect(bb.unconstrained).toBe(false);
    expect(bb.capPinned).toBe(false);
    expect(bb.basketNarrative).toBeUndefined();
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
    const np = recommendOptions(orders, cur, withAbandon, null).find(
      (r) => r.id === "net-profit"
    )!;
    expect(np.unconstrained).toBe(false);
    // The current config (T=100, fee=10) is always a candidate, so never negative.
    expect(np.contributionDelta).toBeGreaterThanOrEqual(0);
  });

  it("flags unconstrained when the basket-builder optimum pins at the sweep cap", () => {
    // Order at $995 with a tiny $2 fee: building to T=1000 gains (1000-995)*0.8 = $4
    // of margin vs $2 of fee revenue — so the fallback sweep pins at the $1000 cap.
    const cur: Scheme = { standard: { tier: "standard", fee: 2, freeThreshold: 100, avgCost: 3 } };
    const b: BehaviorParams = { cogsPercent: 0.2, upliftRate: 1, upliftWindow: 20, abandonRate: 0 };
    const recs = recommendOptions(Array.from({ length: 20 }, () => o(995, "standard")), cur, b, null);
    const bb = recs.find((r) => r.id === "basket-builder")!;
    expect(bb.scheme.standard!.freeThreshold).toBe(1000);
    expect(bb.unconstrained).toBe(true);
    expect(bb.capPinned).toBe(true);
  });

  it("sets capPinned=true when the net-profit fee optimum pins at the fee cap with non-zero abandonment", () => {
    // Single used tier -> old 2D sweep. std fee $30, free over $250, cost $7; five
    // orders 100..180 all paying $30 today; abandonRate 0.01. maxFee = 60; revenue
    // beats abandonment loss all the way up -> the optimum pins at fee=60 (hand-
    // verified in the v3 test this ports: delta 127.35 at fee 60 vs 123.25 at 59).
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
    const np = recommendOptions(orders, cur, b, null).find((r) => r.id === "net-profit")!;
    expect(np.scheme.standard!.fee).toBe(60); // pins at the cap
    expect(np.unconstrained).toBe(false); // abandonRate > 0
    expect(np.capPinned).toBe(true);
  });

  it("rounds the fee sweep ceiling up so the fee-pin guard works for non-integer fees", () => {
    // std fee 16.55 -> ceiling ceil(33.1) = 34. With abandonment 0, revenue is
    // monotone in fee, so net-profit pins at 34 and must be flagged.
    const cur: Scheme = { standard: { tier: "standard", fee: 16.55, freeThreshold: 100, avgCost: 7 } };
    const noAbandon: BehaviorParams = { cogsPercent: 0.5, upliftRate: 0, upliftWindow: 20, abandonRate: 0 };
    const np = recommendOptions([o(80, "standard")], cur, noAbandon, null).find(
      (r) => r.id === "net-profit"
    )!;
    expect(np.scheme.standard!.fee).toBe(34);
    expect(np.unconstrained).toBe(true);
  });

  it("excludes orders whose tier is not in the current scheme", () => {
    const stdOnly: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 } };
    const withStray = recommendOptions(
      [o(80, "standard"), o(120, "nextday" as CanonicalTier)],
      stdOnly,
      behavior,
      null
    );
    const without = recommendOptions([o(80, "standard")], stdOnly, behavior, null);
    expect(withStray).toEqual(without);
  });

  it("handles an all-free current scheme without crashing (basket fallback stays at zero)", () => {
    // Fee 0 everywhere -> every basket threshold candidate is free for everyone.
    const freeScheme: Scheme = { standard: { tier: "standard", fee: 0, freeThreshold: null, avgCost: 7 } };
    const recs = recommendOptions([o(80, "standard")], freeScheme, behavior, null);
    expect(recs).toHaveLength(2);
    const bb = recs.find((r) => r.id === "basket-builder")!;
    expect(bb.contributionDelta).toBeCloseTo(0);
  });

  it("targets the dominant paid tier when standard is absent", () => {
    const expressOnly: Scheme = {
      express: { tier: "express", fee: 15, freeThreshold: 200, avgCost: 12 },
    };
    const recs = recommendOptions([o(80, "express")], expressOnly, behavior, null);
    expect(recs).toHaveLength(2);
    for (const rec of recs) {
      for (const t of rec.changedTiers) expect(t).toBe("express");
      expect(rec.scheme.standard).toBeUndefined();
    }
  });

  it("basket-builder derives the threshold from order clusters plus one typical unit", () => {
    // Dense cluster 140-170 (20 orders) -> candidate 170 + $45 = $215. Four paying
    // orders at 175/185 sit within one $45 unit of 215 (but OUTSIDE the $20 slider
    // window) and build with weight 0.3: margin gain 0.3*0.7*(40*2 + 30*2) = $29.4
    // against $12 of lost fees (4 x 0.3 x $10) -> delta +$17.4 > 0, so 215 wins.
    const cur: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: null, avgCost: 7 } };
    const orders: TaggedOrder[] = [
      ...Array.from({ length: 7 }, () => o(145, "standard")),
      ...Array.from({ length: 7 }, () => o(155, "standard")),
      ...Array.from({ length: 6 }, () => o(165, "standard")),
      o(175, "standard"),
      o(175, "standard"),
      o(185, "standard"),
      o(185, "standard"),
    ];
    const units: UnitStats = {
      typicalUnitPrice: 45,
      ordersWithUnits: 24,
      unitShare: { single: 0.5, double: 0.3, threePlus: 0.2 },
    };
    const b: BehaviorParams = { cogsPercent: 0.3, upliftRate: 0.3, upliftWindow: 20, abandonRate: 0.1 };
    const bb = recommendOptions(orders, cur, b, units).find((r) => r.id === "basket-builder")!;
    expect(bb.scheme.standard!.freeThreshold).toBe(215);
    expect(bb.scheme.standard!.fee).toBe(10); // fees unchanged
    expect(bb.changedTiers).toEqual(["standard"]);
    expect(bb.upliftMarginGain).toBeCloseTo(29.4);
    expect(bb.contributionDelta).toBeCloseTo(17.4);
    // Narrative names the threshold, the source cluster, and the unit price.
    expect(bb.basketNarrative).toContain("$215");
    expect(bb.basketNarrative).toContain("$140");
    expect(bb.basketNarrative).toContain("$170");
    expect(bb.basketNarrative).toContain("one");
    expect(bb.basketNarrative).toContain("45");
    // Window override proof: under the $20 slider window nothing builds at T=215 —
    // the 175/185 orders only build inside the $45 unit window.
    expect(evaluateScheme(orders, cur, bb.scheme, b)!.upliftMarginGain).toBe(0);
    expect(
      evaluateScheme(orders, cur, bb.scheme, { ...b, upliftWindow: 45 })!.contributionDelta
    ).toBeCloseTo(bb.contributionDelta);
  });

  it("basket-builder without unitStats matches a direct slider-window sweep on the dominant tier", () => {
    const orders = [
      o(80, "standard"),
      o(150, "standard"),
      o(150, "express"),
      o(250, "express"),
      o(60, "standard"),
    ];
    const b: BehaviorParams = { cogsPercent: 0.4, upliftRate: 0.3, upliftWindow: 20, abandonRate: 0.1 };
    const bb = recommendOptions(orders, current, b, null).find((r) => r.id === "basket-builder")!;
    const tier = dominantPaidTier(orders, current)!;
    let bestT: number | null | undefined;
    let bestDelta = -Infinity;
    for (const t of thresholdCandidates(orders)) {
      const cand: Scheme = { ...current, [tier]: { ...current[tier]!, freeThreshold: t } };
      const delta = evaluateScheme(orders, current, cand, b)!.contributionDelta;
      if (delta > bestDelta) {
        bestDelta = delta;
        bestT = t;
      }
    }
    expect(bb.scheme[tier]!.freeThreshold).toBe(bestT);
    expect(bb.scheme[tier]!.fee).toBe(current[tier]!.fee);
    expect(bb.contributionDelta).toBeCloseTo(bestDelta);
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
    // No unitStats -> basket-builder evaluates with the caller's slider window, so a
    // plain evaluateScheme of its winning scheme must reproduce the metrics exactly.
    const bb = recommendOptions(orders, current, b, null).find((r) => r.id === "basket-builder")!;
    const e = evaluateScheme(orders, current, bb.scheme, b)!;
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

  it("returns [] without analysable orders", () => {
    expect(thresholdCurves([], current, ZERO)).toEqual([]);
  });

  it("targets the dominant paid tier when standard is absent", () => {
    // express-only scheme: dominant = express → curves are returned (non-empty).
    const expressOnly: Scheme = { express: { tier: "express", fee: 15, freeThreshold: 200, avgCost: 12 } };
    const curves = thresholdCurves([o(80, "express")], expressOnly, ZERO);
    expect(curves.length).toBeGreaterThan(0);
    expect(curves.every((p) => typeof p.threshold === "number")).toBe(true);
  });
});
