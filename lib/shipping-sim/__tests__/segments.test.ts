import { describe, it, expect } from "vitest";
import {
  NEAR_THRESHOLD_BAND,
  segmentOrders,
  segmentOutcomes,
} from "@/lib/shipping-sim/segments";
import {
  bucketOrders,
  mechanicalScenario,
  prepareBuckets,
} from "@/lib/shipping-sim/scenario";
import { CanonicalTier, Scheme, TaggedOrder } from "@/lib/shipping-sim/types";

function o(gross: number, tier: CanonicalTier, units?: number): TaggedOrder {
  return { gross, shippingPaid: 0, rawService: "x", tier, units };
}

describe("segmentOrders", () => {
  const current: Scheme = {
    standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 },
    express: { tier: "express", fee: 15, freeThreshold: 200, avgCost: 12 },
  };

  it("uses a fixed $25 descriptive band, not a tunable window", () => {
    expect(NEAR_THRESHOLD_BAND).toBe(25);
  });

  it("partitions orders by item band x value position x tier; valueShare sums to 1", () => {
    // $25 band -> standard "just below" is [75, 100), express [175, 200).
    const orders = [
      o(50, "standard", 1), // single|wellBelow|standard
      o(80, "standard", 2), // double|justBelow|standard
      o(150, "standard", 3), // threePlus|atOrAbove|standard
      o(100, "express", 1), // single|wellBelow|express
      o(180, "express"), // unknown|justBelow|express (no line-item data)
      o(250, "express", 5), // threePlus|atOrAbove|express
    ];
    const segments = segmentOrders(orders, current);
    expect(segments).toHaveLength(6);
    const byKey = new Map(segments.map((s) => [s.key, s]));
    expect(byKey.get("single|wellBelow|standard")).toMatchObject({
      itemBand: "single",
      position: "wellBelow",
      tier: "standard",
      orders: 1,
    });
    expect(byKey.get("double|justBelow|standard")).toMatchObject({ orders: 1 });
    expect(byKey.get("threePlus|atOrAbove|standard")).toMatchObject({ orders: 1 });
    expect(byKey.get("single|wellBelow|express")).toMatchObject({ orders: 1 });
    expect(byKey.get("unknown|justBelow|express")).toMatchObject({
      itemBand: "unknown",
      orders: 1,
    });
    expect(byKey.get("threePlus|atOrAbove|express")).toMatchObject({ orders: 1 });
    // valueShare = gross / 810 per segment; shares sum to 1.
    expect(byKey.get("single|wellBelow|standard")!.valueShare).toBeCloseTo(50 / 810);
    expect(byKey.get("threePlus|atOrAbove|express")!.valueShare).toBeCloseTo(250 / 810);
    const total = segments.reduce((sum, s) => sum + s.valueShare, 0);
    expect(total).toBeCloseTo(1);
  });

  it("merges orders sharing a band/position/tier into one segment", () => {
    const orders = [o(80, "standard", 1), o(90, "standard", 1), o(95, "standard", 1)];
    const segments = segmentOrders(orders, current);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      key: "single|justBelow|standard",
      orders: 3,
      valueShare: 1,
    });
  });

  it("flat tiers report wellBelow when the flat fee is positive, atOrAbove when free", () => {
    const flatPaid: Scheme = {
      standard: { tier: "standard", fee: 10, freeThreshold: null, avgCost: 7 },
    };
    expect(segmentOrders([o(500, "standard", 1)], flatPaid)[0].position).toBe("wellBelow");

    const flatFree: Scheme = {
      standard: { tier: "standard", fee: 0, freeThreshold: null, avgCost: 7 },
    };
    expect(segmentOrders([o(50, "standard", 1)], flatFree)[0].position).toBe("atOrAbove");
  });

  it("treats zero/negative units as unknown and excludes tiers not in the scheme", () => {
    const stdOnly: Scheme = {
      standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 },
    };
    const segments = segmentOrders([o(50, "standard", 0), o(50, "nextday", 1)], stdOnly);
    expect(segments).toHaveLength(1);
    expect(segments[0].itemBand).toBe("unknown");
    expect(segments[0].valueShare).toBeCloseTo(1); // denominator covers valid orders only
  });

  it("returns [] when there are no analysable orders", () => {
    expect(segmentOrders([], current)).toEqual([]);
  });
});

describe("segmentOutcomes", () => {
  const current: Scheme = {
    standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 },
    express: { tier: "express", fee: 15, freeThreshold: null, avgCost: 12 },
  };
  // Candidate raises the standard fee + threshold and prices express up, so the book
  // produces newly-paying, newly-free and tier-switching orders at once.
  const candidate: Scheme = {
    standard: { tier: "standard", fee: 18, freeThreshold: 150, avgCost: 7 },
    express: { tier: "express", fee: 40, freeThreshold: null, avgCost: 12 },
  };
  const orders = [
    o(90, "standard", 1), // pays 18
    o(130, "standard", 2), // free today, pays 18 under the candidate
    o(160, "standard", 3), // free under both
    o(100, "express"), // switches to standard, pays 18
    o(170, "express", 1), // switches to standard, newly free
  ];

  it("per-segment outcomes sum to the whole-book scenario (partition property)", () => {
    const outcomes = segmentOutcomes(orders, current, candidate);
    const prepared = prepareBuckets(bucketOrders(orders), current);
    const whole = mechanicalScenario(prepared, candidate);
    const sum = (pick: (oc: (typeof outcomes)[number]) => number) =>
      outcomes.reduce((acc, oc) => acc + pick(oc), 0);

    expect(sum((oc) => oc.switches)).toBeCloseTo(whole.impact.switchedTier);
    const wholeFree = orders.length * whole.freeOrderShare;
    expect(sum((oc) => oc.free)).toBeCloseTo(wholeFree);
    expect(sum((oc) => oc.pays)).toBeCloseTo(orders.length - wholeFree);
    // Sanity: the fixture really exercises switching.
    expect(whole.impact.switchedTier).toBeGreaterThan(0);
  });

  it("keys align one-to-one with segmentOrders for the same inputs", () => {
    const segments = segmentOrders(orders, current);
    const outcomes = segmentOutcomes(orders, current, candidate);
    expect(outcomes.map((oc) => oc.segmentKey)).toEqual(segments.map((s) => s.key));
  });

  it("computes a hand-verified single-segment outcome", () => {
    // The $130 standard order (2 items) is free today (>= $100) so its CURRENT
    // position is atOrAbove. Under the candidate its free line moves to $150, so it
    // pays the $18 fee on its own tier — one payer, no free order, no switch.
    const outcomes = segmentOutcomes(orders, current, candidate);
    const seg = outcomes.find((oc) => oc.segmentKey === "double|atOrAbove|standard")!;
    expect(seg.pays).toBeCloseTo(1);
    expect(seg.free).toBeCloseTo(0);
    expect(seg.switches).toBeCloseTo(0);
  });

  it("returns [] when there are no analysable orders", () => {
    expect(segmentOutcomes([], current, candidate)).toEqual([]);
  });

  // REGRESSION (challenge #3): bucket rounding kicked in at >5000 distinct grosses
  // for the whole book but not for the smaller per-segment subsets, so the segment
  // table and the order-impact table disagreed (4544 vs 4552) despite this
  // function's "sum exactly" contract.
  it("sums exactly to the whole book even past 5000 distinct order values", () => {
    const wide: Scheme = {
      standard: { tier: "standard", fee: 10, freeThreshold: 250, avgCost: 6 },
    };
    const moved: Scheme = {
      standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 6 },
    };
    const orders = Array.from({ length: 5200 }, (_, i) => o(60 + i * 0.061, "standard"));

    const prepared = prepareBuckets(bucketOrders(orders), wide);
    const whole = mechanicalScenario(prepared, moved);
    const outcomes = segmentOutcomes(orders, wide, moved);
    const sum = (pick: (oc: (typeof outcomes)[number]) => number) =>
      outcomes.reduce((acc, oc) => acc + pick(oc), 0);

    expect(sum((oc) => oc.free)).toBe(whole.freeOrderShare * whole.orderCount);
    expect(sum((oc) => oc.switches)).toBe(whole.impact.switchedTier);
    expect(sum((oc) => oc.pays) + sum((oc) => oc.free)).toBe(orders.length);
  });

  it("reports whole orders, never fractions", () => {
    const orders = Array.from({ length: 7 }, (_, i) => o(90 + i * 5, "standard"));
    const wide: Scheme = {
      standard: { tier: "standard", fee: 10, freeThreshold: 250, avgCost: 6 },
    };
    const moved: Scheme = {
      standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 6 },
    };
    for (const outcome of segmentOutcomes(orders, wide, moved)) {
      expect(Number.isInteger(outcome.pays)).toBe(true);
      expect(Number.isInteger(outcome.free)).toBe(true);
      expect(Number.isInteger(outcome.switches)).toBe(true);
    }
  });
});
