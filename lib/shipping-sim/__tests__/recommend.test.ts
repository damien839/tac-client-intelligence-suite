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

  /**
   * The v4.1 lexicographic cost-recovery comparator, restated from the spec —
   * duplicated here on purpose so the tests pin the contract, not the implementation.
   */
  function neutralDistanceOf(e: { shippingRevenue: number; carrierSpend: number }): number {
    return Math.abs(e.shippingRevenue - e.carrierSpend);
  }
  function isNeutralOf(e: { shippingRevenue: number; carrierSpend: number }): boolean {
    return neutralDistanceOf(e) <= 0.02 * e.carrierSpend;
  }
  function strictlyBetterForCostRecovery(
    a: { shippingRevenue: number; carrierSpend: number; contributionDelta: number },
    b: { shippingRevenue: number; carrierSpend: number; contributionDelta: number }
  ): boolean {
    const aN = isNeutralOf(a);
    const bN = isNeutralOf(b);
    if (aN !== bN) return aN;
    if (aN) return a.contributionDelta > b.contributionDelta;
    const dA = neutralDistanceOf(a);
    const dB = neutralDistanceOf(b);
    if (dA !== dB) return dA < dB;
    return a.contributionDelta > b.contributionDelta;
  }

  it("returns exactly [net-profit, basket-builder] with consistent changedTiers", () => {
    const recs = recommendOptions(shiftOrders, shiftCurrent, shiftBehavior, null);
    expect(recs.map((r) => r.id)).toEqual(["net-profit", "basket-builder"]);
    expect(recs[0].label).toBe("Cost-recovery optimiser");
    expect(recs[1].label).toBe("Basket-builder");
    for (const rec of recs) expectChangedTiersConsistent(rec, shiftCurrent);
  });

  it("returns [] when there are no analysable orders", () => {
    expect(recommendOptions([], current, behavior, null)).toEqual([]);
  });

  it("cost-recovery closes the subsidy: shifts freight onto standard and lowers fees to neutral", () => {
    const np = recommendOptions(shiftOrders, shiftCurrent, shiftBehavior, null).find(
      (r) => r.id === "net-profit"
    )!;
    // Derived independently (exhaustive fine-grid search under the spec comparator):
    // move all 20 express orders onto standard (carrier $30 -> $5) and charge every
    // order $5: revenue 22 x $5 = $110 = carrier spend -> exactly neutral. Nobody is
    // worse off ($5 < $10/$12) so nothing abandons; contribution = $0 - (-$350) = +$350.
    // Express fee $8 is the lowest fee that prices express above every order's
    // revealed premium ($2): stay premium $8 - $5 = $3 > $2 -> all switch.
    expect(np.scheme.standard!.fee).toBe(5);
    expect(np.scheme.standard!.freeThreshold).toBe(90);
    expect(np.scheme.express!.fee).toBe(8);
    expect(np.scheme.express!.freeThreshold).toBeNull();
    expect(np.changedTiers).toEqual(["standard", "express"]);
    expect(np.contributionDelta).toBeCloseTo(350);
    expect(np.recoveryRate).toBeCloseTo(1);
    expect(np.expectedOrdersLost).toBe(0);
    expect(np.unconstrained).toBe(false);
    expect(np.capPinned).toBe(false);
    // Subsidy contract: current recovery < 100%; winner is in the neutral band with
    // POSITIVE contribution (closing a subsidy makes money).
    const noUplift = { ...shiftBehavior, upliftRate: 0 };
    const currentFacts = evaluateScheme(shiftOrders, shiftCurrent, shiftCurrent, noUplift)!;
    expect(currentFacts.recoveryRate).toBeLessThan(1);
    expect(np.recoveryRate).toBeGreaterThanOrEqual(0.98);
    expect(np.recoveryRate).toBeLessThanOrEqual(1.02);
    expect(np.contributionDelta).toBeGreaterThan(0);
    // Metrics agree with an independent evaluation; the freight shift is visible.
    const ev = evaluateScheme(shiftOrders, shiftCurrent, np.scheme, noUplift)!;
    expect(ev.contributionDelta).toBeCloseTo(np.contributionDelta);
    expect(ev.netShippingProfitDelta).toBeCloseTo(np.netShippingProfitDelta);
    expect(ev.volumeByTier.standard).toBeCloseTo(22);
    expect(ev.volumeByTier.express).toBe(0);
  });

  it("cost-recovery winner is not beaten by any sampled candidate under the lexicographic objective", () => {
    const np = recommendOptions(shiftOrders, shiftCurrent, shiftBehavior, null).find(
      (r) => r.id === "net-profit"
    )!;
    const noUplift = { ...shiftBehavior, upliftRate: 0 };
    const winner = evaluateScheme(shiftOrders, shiftCurrent, np.scheme, noUplift)!;
    const sample = (std: { fee: number; t: number | null }, exp: { fee: number; t: number | null }) =>
      evaluateScheme(
        shiftOrders,
        shiftCurrent,
        {
          standard: { ...shiftCurrent.standard!, fee: std.fee, freeThreshold: std.t },
          express: { ...shiftCurrent.express!, fee: exp.fee, freeThreshold: exp.t },
        },
        noUplift
      )!;
    const samples = [
      sample({ fee: 10, t: 100 }, { fee: 12, t: null }), // current
      sample({ fee: 10, t: 100 }, { fee: 20, t: null }),
      sample({ fee: 30, t: 100 }, { fee: 30, t: null }),
      sample({ fee: 10, t: null }, { fee: 12, t: null }),
      sample({ fee: 20, t: 200 }, { fee: 24, t: null }),
      sample({ fee: 0, t: 0 }, { fee: 0, t: null }),
      sample({ fee: 14, t: 100 }, { fee: 14, t: null }), // old objective's hand probe
    ];
    for (const s of samples) {
      expect(strictlyBetterForCostRecovery(s, winner)).toBe(false);
    }
    // The "raise everyone to ~$28" scheme is ALSO neutral (revenue covers the still-
    // expensive express freight via abandonment-damped fees) but with far lower
    // contribution — among neutral candidates the higher contribution must win.
    // This pins the thin-manifold case the coarse grid alone would have missed.
    const highFeeNeutral = sample({ fee: 28, t: 100 }, { fee: 28, t: null });
    expect(isNeutralOf(highFeeNeutral)).toBe(true);
    expect(strictlyBetterForCostRecovery(winner, highFeeNeutral)).toBe(true);
    expect(strictlyBetterForCostRecovery(highFeeNeutral, winner)).toBe(false);
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

  it("nudges the near-neutral Damo-shaped book into the neutral band (no freight shift pays here)", () => {
    const recs = recommendOptions(damoOrders, damoCurrent, damoBehavior, damoUnits);
    expect(recs.map((r) => r.id)).toEqual(["net-profit", "basket-builder"]);
    const [np, bb] = recs;
    // Derived independently (exhaustive 457k-candidate search under the spec
    // comparator). This book is already 97.9% recovered (rev $2,790 / spend $2,850,
    // distance $60 vs band $57 — just outside). Any express re-pricing dumps the
    // switchers into the standard free band (T $250 sits below most express carts),
    // destroying $60 fees faster than it cuts $30 of freight, so NO freight shift
    // reaches the +-2% band. The lexicographic winner raises the standard fee
    // $30 -> $32: the 3 paying standard orders see a $2 increase (2% abandon each),
    // rev $2,794.08 / spend $2,848.50 -> distance $54.42 <= band $56.97 (recovery
    // 98.1%), contribution -$0.30 (= +$5.58 net shipping - $5.88 abandoned margin).
    expect(np.scheme.standard!.fee).toBe(32);
    expect(np.scheme.standard!.freeThreshold).toBe(250);
    expect(np.scheme.express!.fee).toBe(60);
    expect(np.scheme.express!.freeThreshold).toBeNull();
    expect(np.changedTiers).toEqual(["standard"]);
    expect(np.contributionDelta).toBeCloseTo(-0.3);
    expect(np.recoveryRate).toBeGreaterThanOrEqual(0.98);
    expect(np.recoveryRate).toBeLessThanOrEqual(1.02);
    expect(np.unconstrained).toBe(false);
    // Was pinned at the $120 express-fee cap under the old objective; overshoot is
    // now penalised, so nothing pins.
    expect(np.capPinned).toBe(false);
    // Materiality floor: contribution < $1 BUT the winner is strictly closer to
    // neutral than the current scheme ($54.42 < $60.00) -> it SURVIVES the floor.
    expect(np.changedTiers).not.toEqual([]);
    // Metrics agree with an independent evaluation of the winning scheme.
    const noUplift = { ...damoBehavior, upliftRate: 0 };
    const ev = evaluateScheme(damoOrders, damoCurrent, np.scheme, noUplift)!;
    expect(ev.contributionDelta).toBeCloseTo(np.contributionDelta);
    // No candidate we can hand-construct beats it under the comparator — including
    // the OLD objective's profiteering optimum (price express off the menu at the
    // $120 cap, capture volume at $58), which is far from neutral and must lose.
    const winner = ev;
    const probe = (std: { fee: number; t: number | null }, exp: { fee: number; t: number | null }) =>
      evaluateScheme(
        damoOrders,
        damoCurrent,
        {
          standard: { ...damoCurrent.standard!, fee: std.fee, freeThreshold: std.t },
          express: { ...damoCurrent.express!, fee: exp.fee, freeThreshold: exp.t },
        },
        noUplift
      )!;
    const probes = [
      probe({ fee: 30, t: 250 }, { fee: 60, t: null }), // current -> distance $60
      probe({ fee: 40, t: 250 }, { fee: 60, t: null }),
      probe({ fee: 50, t: 250 }, { fee: 60, t: null }), // neutral, more abandonment
      probe({ fee: 30, t: 600 }, { fee: 60, t: null }),
      probe({ fee: 30, t: null }, { fee: 60, t: null }),
      probe({ fee: 30, t: 250 }, { fee: 58, t: null }),
      probe({ fee: 29, t: 250 }, { fee: 60, t: null }), // freight shift via cheap std
      probe({ fee: 58, t: 540 }, { fee: 120, t: null }), // old profiteering optimum
    ];
    for (const p of probes) {
      expect(strictlyBetterForCostRecovery(p, winner)).toBe(false);
    }
    const oldOptimum = probes[probes.length - 1];
    expect(isNeutralOf(oldOptimum)).toBe(false);
    expect(strictlyBetterForCostRecovery(winner, oldOptimum)).toBe(true);
    // No dense $10-bin cluster exists in this book (all bins hold <3 orders), so the
    // unit-driven basket sweep has no candidates: keep current, no narrative.
    expect(bb.changedTiers).toEqual([]);
    expect(bb.contributionDelta).toBeCloseTo(0);
    expect(bb.basketNarrative).toBeUndefined();
  });

  it("single-used-tier data degrades net-profit to the old 2D threshold x fee sweep (hand-verified)", () => {
    // Current: std fee $10, FLAT, cost $7. One order, gross $185 (pays $10 today):
    // rev $10 vs spend $7 -> distance $3 > band 2% x $7 = $0.14, over-recovering 143%.
    // Neutral candidates need |fee - 7| <= 0.14 with the order still paying -> fee $7
    // exactly (abandonment is 0, so EV weights are 1). The order pays whenever
    // T >= 190 or T is null; thresholds iterate ascending inside the fee-major loop,
    // so the first (kept) neutral is fee $7, T $190. All fee-7 candidates tie at
    // contribution (7-7) - (10-7) = -$3.
    // Materiality floor: -$3 < $1 BUT distance 0 < current distance 3 -> survives.
    // unconstrained is ALWAYS false for this option now (overshoot is penalised, so
    // the charge-more degeneracy cannot survive the neutrality objective); fee 7 and
    // T 190 sit inside the swept ranges, so capPinned is false too.
    const cur: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: null, avgCost: 7 } };
    const b: BehaviorParams = { cogsPercent: 0.2, upliftRate: 1, upliftWindow: 20, abandonRate: 0 };
    const np = recommendOptions([o(185, "standard")], cur, b, null).find(
      (r) => r.id === "net-profit"
    )!;
    expect(np.scheme.standard!.fee).toBe(7);
    expect(np.scheme.standard!.freeThreshold).toBe(190);
    expect(np.changedTiers).toEqual(["standard"]);
    expect(np.contributionDelta).toBeCloseTo(-3);
    expect(np.recoveryRate).toBeCloseTo(1);
    expect(np.upliftMarginGain).toBe(0); // uplift forced off
    expect(np.unconstrained).toBe(false);
    expect(np.capPinned).toBe(false);
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

  it("prices abandonment into the neutrality search (EV-neutral beats naive fee-equals-cost)", () => {
    // 80 pays $10 today; 150/170 ship free. rev $10 / spend $21 -> distance $11.
    // Hand-derivation under the spec comparator (confirmed by exhaustive search):
    // - fee $7, all pay (T>=180): rev == spend exactly whatever abandons -> distance 0,
    //   but the newly-paying 150/170 abandon 35% each (rate 0.5 per $10, $7 increase):
    //   contribution = +11 - 0.35x(150+170)x0.5 = -$45.
    // - fee $13, T $160 (170 stays free): w80 = 0.85 ($3 increase), w150 = 0.35
    //   ($13 increase): rev 1.2x13 = $15.60, spend 1.2x7 + 7 = $15.40 -> distance
    //   $0.20 <= band $0.308: ALSO neutral, contribution = 0.2 + 11 - 54.75 = -$43.55.
    // Among neutral candidates the higher contribution wins -> fee 13, T 160.
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
    expect(np.scheme.standard!.fee).toBe(13);
    expect(np.scheme.standard!.freeThreshold).toBe(160);
    expect(np.contributionDelta).toBeCloseTo(-43.55);
    expect(np.recoveryRate).toBeGreaterThanOrEqual(0.98);
    expect(np.recoveryRate).toBeLessThanOrEqual(1.02);
    expect(np.unconstrained).toBe(false);
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

  it("corrects a profiteering book to cost even at large negative contribution", () => {
    // PROFITEERING CONTRACT (v4.1): std fee $30, free over $250, cost $7; five orders
    // 100..180 all paying $30 today -> rev $150 / spend $35 = 429% recovery. The old
    // objective pinned the fee at the $60 cap; the cost-recovery objective lowers it
    // to cost: fee $7 (all still paying, first all-pay threshold T $190... here every
    // gross < 250 already pays, ties keep the lowest threshold where all pay -> $190).
    // contribution = (35-35) - (150-35) = -$115 — negative ON PURPOSE: the option's
    // job is to stop profiteering, and the floor spares neutrality improvements
    // (distance 0 < current distance 115).
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
    expect(np.scheme.standard!.fee).toBe(7);
    expect(np.scheme.standard!.freeThreshold).toBe(190);
    expect(np.changedTiers).toEqual(["standard"]);
    expect(np.contributionDelta).toBeCloseTo(-115);
    expect(np.recoveryRate).toBeCloseTo(1); // moved toward 1.0 from 4.29
    expect(np.unconstrained).toBe(false);
    expect(np.capPinned).toBe(false); // no longer pinned at the fee cap
  });

  it("sets capPinned=true when even the fee cap cannot reach neutrality (deep subsidy)", () => {
    // std fee $10 flat, carrier cost $50: recovery 20%. maxFee = max(2x10, 30) = 30 —
    // even $30 leaves distance $20 (vs $50 free / $40+ for lower fees), so the
    // distance-minimising winner pins at the cap: fee $30, first paying T $90,
    // contribution (30-50) - (10-50) = +$20. unconstrained stays false even at 0%
    // abandonment — the always-false guarantee of the cost-recovery objective.
    const cur: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: null, avgCost: 50 } };
    const b: BehaviorParams = { cogsPercent: 0.3, upliftRate: 0, upliftWindow: 20, abandonRate: 0 };
    const np = recommendOptions([o(80, "standard")], cur, b, null).find(
      (r) => r.id === "net-profit"
    )!;
    expect(np.scheme.standard!.fee).toBe(30);
    expect(np.scheme.standard!.freeThreshold).toBe(90);
    expect(np.contributionDelta).toBeCloseTo(20);
    expect(np.recoveryRate).toBeCloseTo(0.6); // closest the cap allows
    expect(np.capPinned).toBe(true);
    expect(np.unconstrained).toBe(false);
  });

  it("lowers a profiteering non-integer current fee to cost (fee lever still integer)", () => {
    // std fee $16.55, T $100, cost $7; one order at $80 pays today -> 236% recovery.
    // The integer fee lever finds the exact-neutral fee $7 (first paying T $90).
    // contribution = (7-7) - (16.55-7) = -$9.55; survives the floor (distance 0 < 9.55).
    const cur: Scheme = { standard: { tier: "standard", fee: 16.55, freeThreshold: 100, avgCost: 7 } };
    const noAbandon: BehaviorParams = { cogsPercent: 0.5, upliftRate: 0, upliftWindow: 20, abandonRate: 0 };
    const np = recommendOptions([o(80, "standard")], cur, noAbandon, null).find(
      (r) => r.id === "net-profit"
    )!;
    expect(np.scheme.standard!.fee).toBe(7);
    expect(np.scheme.standard!.freeThreshold).toBe(90);
    expect(np.contributionDelta).toBeCloseTo(-9.55);
    expect(np.recoveryRate).toBeCloseTo(1);
    expect(np.unconstrained).toBe(false);
  });

  it("picks the higher-contribution candidate among two neutral candidates", () => {
    // TWO-NEUTRAL CONTRACT (v4.1): std fee $5, T $100, cost $10 (subsidised: recovery
    // 25%). Orders 80 (pays $5) and 150 (free). Two distinct neutral families exist:
    // - fee $10 = cost, everyone pays (T >= 160): rev == spend exactly -> distance 0;
    //   abandonment (5% on 80, 10% on 150) -> contribution +$5.50.
    // - fee $22, T $90 (only 80 pays, 17% abandons): rev 0.83x22 = $18.26 vs spend
    //   0.83x10 + 10 = $18.30 -> distance $0.04 <= band $0.366; contribution +$8.16.
    // Both neutral -> the HIGHER CONTRIBUTION one must win even though its distance
    // is larger. Also the subsidy contract: winner is neutral-band, contribution > 0.
    const cur: Scheme = { standard: { tier: "standard", fee: 5, freeThreshold: 100, avgCost: 10 } };
    const b: BehaviorParams = { cogsPercent: 0.5, upliftRate: 0, upliftWindow: 20, abandonRate: 0.1 };
    const orders = [o(80, "standard"), o(150, "standard")];
    const np = recommendOptions(orders, cur, b, null).find((r) => r.id === "net-profit")!;
    expect(np.scheme.standard!.fee).toBe(22);
    expect(np.scheme.standard!.freeThreshold).toBe(90);
    expect(np.contributionDelta).toBeCloseTo(8.16);
    expect(np.contributionDelta).toBeGreaterThan(0);
    expect(np.recoveryRate).toBeGreaterThanOrEqual(0.98);
    expect(np.recoveryRate).toBeLessThanOrEqual(1.02);
    // Construct the rival neutral explicitly and verify the comparator ordering.
    const rival = evaluateScheme(
      orders,
      cur,
      { standard: { tier: "standard", fee: 10, freeThreshold: 200, avgCost: 10 } },
      b
    )!;
    const winner = evaluateScheme(orders, cur, np.scheme, b)!;
    expect(isNeutralOf(rival)).toBe(true);
    expect(rival.contributionDelta).toBeCloseTo(5.5);
    expect(strictlyBetterForCostRecovery(winner, rival)).toBe(true);
  });

  it("collapses to keep-current when the book is already neutral (materiality floor)", () => {
    // fee $7 flat == cost $7: distance 0 already. The sweep's best candidate is
    // current-equivalent (contribution $0 < $1) and NOT neutrality-improving
    // (distance 0 is not < 0) -> keep-current: no changed tiers, exact zeros.
    const cur: Scheme = { standard: { tier: "standard", fee: 7, freeThreshold: null, avgCost: 7 } };
    const b: BehaviorParams = { cogsPercent: 0.2, upliftRate: 0, upliftWindow: 20, abandonRate: 0.1 };
    const np = recommendOptions([o(185, "standard")], cur, b, null).find(
      (r) => r.id === "net-profit"
    )!;
    expect(np.changedTiers).toEqual([]);
    expect(np.scheme).toEqual(cur);
    expect(np.contributionDelta).toBe(0);
    expect(np.unconstrained).toBe(false);
    expect(np.capPinned).toBe(false);
  });

  it("collapses an immaterial basket-builder winner (+$0.40) to keep-current", () => {
    // MATERIALITY CONTRACT (v4.1): current flat $10, cost $7; one order at $187.
    // Best basket candidate is T $200: the order builds (uplift 1.0), gaining
    // (200-187) x 0.8 = $10.40 margin against $10 of lost fee -> +$0.40. Under $1 ->
    // keep-current: changedTiers [], exact zeros, no narrative.
    const cur: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: null, avgCost: 7 } };
    const b: BehaviorParams = { cogsPercent: 0.2, upliftRate: 1, upliftWindow: 20, abandonRate: 0 };
    const orders = [o(187, "standard")];
    // Prove the +$0.40 candidate exists (so the floor, not the sweep, rejects it).
    const best = evaluateScheme(
      orders,
      cur,
      { standard: { tier: "standard", fee: 10, freeThreshold: 200, avgCost: 7 } },
      b
    )!;
    expect(best.contributionDelta).toBeCloseTo(0.4);
    const bb = recommendOptions(orders, cur, b, null).find((r) => r.id === "basket-builder")!;
    expect(bb.changedTiers).toEqual([]);
    expect(bb.scheme).toEqual(cur);
    expect(bb.contributionDelta).toBe(0);
    expect(bb.upliftMarginGain).toBe(0);
    expect(bb.basketNarrative).toBeUndefined();
    expect(bb.unconstrained).toBe(false);
    expect(bb.capPinned).toBe(false);
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
