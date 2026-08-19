import { describe, it, expect } from "vitest";
import { segmentOrders, segmentOutcomes } from "@/lib/shipping-sim/segments";
import {
  behavioralScenario,
  bucketOrders,
  prepareBuckets,
} from "@/lib/shipping-sim/recommend";
import {
  BehaviorParams,
  CanonicalTier,
  Scheme,
  TaggedOrder,
} from "@/lib/shipping-sim/types";

function o(gross: number, tier: CanonicalTier, units?: number): TaggedOrder {
  return { gross, shippingPaid: 0, rawService: "x", tier, units };
}

describe("segmentOrders", () => {
  const current: Scheme = {
    standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 },
    express: { tier: "express", fee: 15, freeThreshold: 200, avgCost: 12 },
  };

  it("partitions orders by item band x value position x tier; valueShare sums to 1", () => {
    // window 45 -> standard "within one unit" band is [55, 100), express [155, 200).
    const orders = [
      o(50, "standard", 1), // single|wellBelow|standard
      o(70, "standard", 2), // double|withinOneUnit|standard
      o(150, "standard", 3), // threePlus|atOrAbove|standard
      o(100, "express", 1), // single|wellBelow|express
      o(180, "express"), // unknown|withinOneUnit|express (no line-item data)
      o(250, "express", 5), // threePlus|atOrAbove|express
    ];
    const segments = segmentOrders(orders, current, 45);
    expect(segments).toHaveLength(6);
    const byKey = new Map(segments.map((s) => [s.key, s]));
    expect(byKey.get("single|wellBelow|standard")).toMatchObject({
      itemBand: "single",
      position: "wellBelow",
      tier: "standard",
      orders: 1,
    });
    expect(byKey.get("double|withinOneUnit|standard")).toMatchObject({ orders: 1 });
    expect(byKey.get("threePlus|atOrAbove|standard")).toMatchObject({ orders: 1 });
    expect(byKey.get("single|wellBelow|express")).toMatchObject({ orders: 1 });
    expect(byKey.get("unknown|withinOneUnit|express")).toMatchObject({
      itemBand: "unknown",
      orders: 1,
    });
    expect(byKey.get("threePlus|atOrAbove|express")).toMatchObject({ orders: 1 });
    // valueShare = gross / 800 per segment; shares sum to 1.
    expect(byKey.get("single|wellBelow|standard")!.valueShare).toBeCloseTo(50 / 800);
    expect(byKey.get("threePlus|atOrAbove|express")!.valueShare).toBeCloseTo(250 / 800);
    const total = segments.reduce((sum, s) => sum + s.valueShare, 0);
    expect(total).toBeCloseTo(1);
  });

  it("merges orders sharing a band/position/tier into one segment", () => {
    const orders = [o(60, "standard", 1), o(70, "standard", 1), o(90, "standard", 1)];
    const segments = segmentOrders(orders, current, 45);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      key: "single|withinOneUnit|standard",
      orders: 3,
      valueShare: 1,
    });
  });

  it("flat tiers report wellBelow when the flat fee is positive, atOrAbove when free", () => {
    const flatPaid: Scheme = {
      standard: { tier: "standard", fee: 10, freeThreshold: null, avgCost: 7 },
    };
    expect(segmentOrders([o(500, "standard", 1)], flatPaid, 45)[0].position).toBe("wellBelow");

    const flatFree: Scheme = {
      standard: { tier: "standard", fee: 0, freeThreshold: null, avgCost: 7 },
    };
    expect(segmentOrders([o(50, "standard", 1)], flatFree, 45)[0].position).toBe("atOrAbove");
  });

  it("treats zero/negative units as unknown and excludes tiers not in the scheme", () => {
    const stdOnly: Scheme = {
      standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 },
    };
    const segments = segmentOrders(
      [o(50, "standard", 0), o(50, "nextday", 1)],
      stdOnly,
      45
    );
    expect(segments).toHaveLength(1);
    expect(segments[0].itemBand).toBe("unknown");
    expect(segments[0].valueShare).toBeCloseTo(1); // denominator covers valid orders only
  });

  it("returns [] when there are no analysable orders", () => {
    expect(segmentOrders([], current, 45)).toEqual([]);
  });
});

describe("segmentOutcomes", () => {
  const current: Scheme = {
    standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 },
    express: { tier: "express", fee: 15, freeThreshold: null, avgCost: 12 },
  };
  // Candidate raises the standard fee + threshold and prices express up, so the book
  // produces every movement at once: builds, abandons, switches, newly-free, payers.
  const candidate: Scheme = {
    standard: { tier: "standard", fee: 18, freeThreshold: 150, avgCost: 7 },
    express: { tier: "express", fee: 40, freeThreshold: null, avgCost: 12 },
  };
  const behavior: BehaviorParams = {
    cogsPercent: 0.4,
    upliftRate: 0.4,
    upliftWindow: 20, // slider value — segmentOutcomes overrides with the window arg
    abandonRate: 0.2,
  };
  const orders = [
    o(90, "standard", 1), // pays 18 or abandons (outside the $30 window)
    o(130, "standard", 2), // free today; builds to 150 / abandons / pays 18
    o(160, "standard", 3), // free under both
    o(100, "express"), // switches to standard, pays 18 (worse off by $3)
    o(170, "express", 1), // switches to standard, newly free
  ];
  const window = 30;

  it("per-segment outcomes sum to the whole-book scenario (partition property)", () => {
    const outcomes = segmentOutcomes(orders, current, candidate, behavior, window);
    const prepared = prepareBuckets(bucketOrders(orders), current);
    const whole = behavioralScenario(prepared, candidate, {
      ...behavior,
      upliftWindow: window,
    });
    const sum = (pick: (oc: (typeof outcomes)[number]) => number) =>
      outcomes.reduce((acc, oc) => acc + pick(oc), 0);

    expect(sum((oc) => oc.abandons)).toBeCloseTo(whole.expectedOrdersLost);
    expect(sum((oc) => oc.builds)).toBeCloseTo(whole.impact.builders);
    expect(sum((oc) => oc.switches)).toBeCloseTo(whole.impact.switchedTier);
    const wholeCompleting = orders.length - whole.expectedOrdersLost;
    const wholeFree = wholeCompleting * whole.freeOrderShare;
    expect(sum((oc) => oc.free)).toBeCloseTo(wholeFree);
    expect(sum((oc) => oc.pays)).toBeCloseTo(wholeCompleting - wholeFree);
    // Sanity: the fixture really exercises every movement.
    expect(whole.expectedOrdersLost).toBeGreaterThan(0);
    expect(whole.impact.builders).toBeGreaterThan(0);
    expect(whole.impact.switchedTier).toBeGreaterThan(0);
  });

  it("keys align one-to-one with segmentOrders for the same inputs", () => {
    const segments = segmentOrders(orders, current, window);
    const outcomes = segmentOutcomes(orders, current, candidate, behavior, window);
    expect(outcomes.map((oc) => oc.segmentKey)).toEqual(segments.map((s) => s.key));
  });

  it("computes a hand-verified single-segment outcome", () => {
    // The $130 standard order (2 items) is free today (>= $100), so position vs the
    // CURRENT threshold is atOrAbove. Under the candidate it pays $18 unless it
    // builds: in the new [120, 150) window with weight 0.4; of the remaining 0.6 the
    // $18 increase abandons at min(1, 0.2*1.8) = 0.36 -> 0.216; 0.384 pays.
    const outcomes = segmentOutcomes(orders, current, candidate, behavior, window);
    const seg = outcomes.find((oc) => oc.segmentKey === "double|atOrAbove|standard")!;
    expect(seg.builds).toBeCloseTo(0.4);
    expect(seg.abandons).toBeCloseTo(0.216);
    expect(seg.pays).toBeCloseTo(0.384);
    expect(seg.free).toBeCloseTo(0.4); // builders ship free
    expect(seg.switches).toBeCloseTo(0);
  });

  it("returns [] when there are no analysable orders", () => {
    expect(segmentOutcomes([], current, candidate, behavior, window)).toEqual([]);
  });
});
