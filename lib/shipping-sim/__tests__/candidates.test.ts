import { describe, it, expect } from "vitest";
import {
  buildCandidates,
  CANDIDATE_ROUNDING,
  evaluateCandidates,
  percentileThresholds,
} from "@/lib/shipping-sim/candidates";
import { changedTiersOf, evaluateScheme, thresholdCurve } from "@/lib/shipping-sim/evaluate";
import { CanonicalTier, Scheme, TaggedOrder } from "@/lib/shipping-sim/types";

function o(gross: number, tier: CanonicalTier = "standard"): TaggedOrder {
  return { gross, shippingPaid: 0, rawService: "x", tier };
}

const current: Scheme = {
  standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 },
  express: { tier: "express", fee: 20, freeThreshold: null, avgCost: 15 },
};

/** 100 orders, gross $10..$1000 in $10 steps — p25/p50/p75 are $250/$500/$750. */
const evenBook = Array.from({ length: 100 }, (_, i) => o((i + 1) * 10));

describe("percentileThresholds", () => {
  it("draws p25 / p50 / p75 rounded to the nearest $25", () => {
    expect(CANDIDATE_ROUNDING).toBe(25);
    expect(percentileThresholds(evenBook)).toEqual([250, 500, 750]);
  });

  it("rounds off-grid percentiles to the nearest $25", () => {
    // Sorted values: p25 = 137 -> 125, p50 = 212 -> 200, p75 = 288 -> 300.
    const orders = [
      ...Array.from({ length: 25 }, () => o(137)),
      ...Array.from({ length: 25 }, () => o(212)),
      ...Array.from({ length: 25 }, () => o(288)),
      ...Array.from({ length: 25 }, () => o(400)),
    ];
    expect(percentileThresholds(orders)).toEqual([125, 200, 300]);
  });

  it("dedupes and drops zero, and handles an empty book", () => {
    expect(percentileThresholds(Array.from({ length: 10 }, () => o(200)))).toEqual([200]);
    expect(percentileThresholds([o(5), o(6), o(7)])).toEqual([]); // all round to $0
    expect(percentileThresholds([])).toEqual([]);
  });
});

describe("buildCandidates", () => {
  it("returns current + percentile thresholds + all-free + no-free, on the dominant paid tier", () => {
    const candidates = buildCandidates(evenBook, current);
    expect(candidates.map((c) => c.id)).toEqual([
      "current",
      "threshold-250",
      "threshold-500",
      "threshold-750",
      "all-free",
      "no-free",
    ]);
    expect(candidates[0].isCurrent).toBe(true);
    for (const candidate of candidates.slice(1)) {
      expect(candidate.changedTiers).toEqual(["standard"]);
      expect(candidate.isCurrent).toBe(false);
      // Every candidate changes exactly one lever: the dominant tier's free line.
      expect(candidate.scheme.standard!.fee).toBe(10);
      expect(candidate.scheme.express).toEqual(current.express);
    }
    expect(candidates.find((c) => c.id === "all-free")!.scheme.standard!.freeThreshold).toBe(0);
    expect(candidates.find((c) => c.id === "no-free")!.scheme.standard!.freeThreshold).toBeNull();
  });

  it("appends the competitor benchmark when it differs from current", () => {
    const competitor: Scheme = {
      standard: { tier: "standard", fee: 5, freeThreshold: 80, avgCost: 7 },
      express: { tier: "express", fee: 20, freeThreshold: null, avgCost: 15 },
    };
    const candidates = buildCandidates(evenBook, current, competitor);
    const row = candidates.find((c) => c.id === "competitor")!;
    expect(row.label).toBe("Competitor benchmark");
    expect(row.changedTiers).toEqual(["standard"]);
  });

  it("drops a competitor benchmark that duplicates the current scheme", () => {
    const candidates = buildCandidates(evenBook, current, { ...current });
    expect(candidates.some((c) => c.id === "competitor")).toBe(false);
  });

  it("drops a percentile candidate that duplicates the current free line", () => {
    // Every order at $200 -> the single percentile candidate is $200; make it current.
    const atTwoHundred: Scheme = {
      standard: { tier: "standard", fee: 10, freeThreshold: 200, avgCost: 7 },
    };
    const candidates = buildCandidates(
      Array.from({ length: 10 }, () => o(200)),
      atTwoHundred
    );
    expect(candidates.map((c) => c.id)).toEqual(["current", "all-free", "no-free"]);
  });

  it("targets the dominant paid tier when standard is absent", () => {
    const expressOnly: Scheme = {
      express: { tier: "express", fee: 20, freeThreshold: 150, avgCost: 15 },
    };
    const orders = Array.from({ length: 20 }, (_, i) => o((i + 1) * 20, "express"));
    for (const candidate of buildCandidates(orders, expressOnly).slice(1)) {
      expect(candidate.changedTiers).toEqual(["express"]);
    }
  });

  it("returns [] when no order maps to a service in the current scheme", () => {
    expect(buildCandidates([], current)).toEqual([]);
    expect(buildCandidates([o(100, "nextday")], current)).toEqual([]);
  });
});

describe("evaluateCandidates", () => {
  it("pins current first and orders the rest by net shipping P&L delta, descending", () => {
    const rows = evaluateCandidates(evenBook, current, buildCandidates(evenBook, current));
    expect(rows[0].candidate.id).toBe("current");
    expect(rows[0].evaluation.netShippingProfitDelta).toBeCloseTo(0);
    const deltas = rows.slice(1).map((r) => r.evaluation.netShippingProfitDelta);
    expect(deltas).toEqual([...deltas].sort((a, b) => b - a));
    // "no free shipping" charges everyone: it always tops a mechanical ranking.
    expect(rows[1].candidate.id).toBe("no-free");
    // "all free" collects nothing: it always sits last.
    expect(rows.at(-1)!.candidate.id).toBe("all-free");
  });

  it("computes the four grid columns mechanically (hand-verified)", () => {
    // 2 orders below the current $100 line (pay $10), 2 above (free). Cost $7 each.
    const orders = [o(50), o(60), o(150), o(160)];
    const candidates = buildCandidates(orders, current);
    const rows = evaluateCandidates(orders, current, candidates);
    const byId = new Map(rows.map((r) => [r.candidate.id, r.evaluation]));

    const base = byId.get("current")!;
    expect(base.shippingRevenue).toBeCloseTo(20);
    expect(base.carrierSpend).toBeCloseTo(28);
    expect(base.recoveryRateCurrent).toBeCloseTo(20 / 28);

    // No free shipping: all 4 orders pay $10 -> revenue 40, cost unchanged at 28.
    const noFree = byId.get("no-free")!;
    expect(noFree.shippingRevenueDelta).toBeCloseTo(20);
    expect(noFree.carrierSpendDelta).toBeCloseTo(0);
    expect(noFree.netShippingProfitDelta).toBeCloseTo(20);
    expect(noFree.recoveryRateCurrent).toBeCloseTo(20 / 28);
    expect(noFree.recoveryRate).toBeCloseTo(40 / 28);

    // Free on everything: revenue 0, cost unchanged.
    const allFree = byId.get("all-free")!;
    expect(allFree.shippingRevenueDelta).toBeCloseTo(-20);
    expect(allFree.carrierSpendDelta).toBeCloseTo(0);
    expect(allFree.netShippingProfitDelta).toBeCloseTo(-20);
    expect(allFree.recoveryRate).toBeCloseTo(0);
    expect(allFree.freeOrderShare).toBeCloseTo(1);
  });

  it("shows a carrier cost delta only when the candidate moves orders between tiers", () => {
    // The express order revealed a $10 premium; pricing express at $60 pushes it to standard.
    const orders = [o(50), o(60, "express")];
    const pricyExpress: Scheme = {
      ...current,
      express: { tier: "express", fee: 60, freeThreshold: null, avgCost: 15 },
    };
    const rows = evaluateCandidates(orders, current, [
      { id: "current", label: "Current", shortLabel: "Current", scheme: current, changedTiers: [], isCurrent: true },
      {
        id: "pricy-express",
        label: "Pricy express",
        shortLabel: "Pricy",
        scheme: pricyExpress,
        changedTiers: changedTiersOf(current, pricyExpress),
        isCurrent: false,
      },
    ]);
    const moved = rows.find((r) => r.candidate.id === "pricy-express")!.evaluation;
    expect(moved.impact.switchedTier).toBe(1);
    expect(moved.carrierSpendDelta).toBeCloseTo(7 - 15); // express $15 -> standard $7
    expect(moved.shippingRevenueDelta).toBeCloseTo(10 - 20); // $20 express fee -> $10 standard
    expect(moved.netShippingProfitDelta).toBeCloseTo(-10 - -8);
  });
});

describe("evaluateScheme", () => {
  it("returns null when there are no analysable orders", () => {
    expect(evaluateScheme([], current, current)).toBeNull();
    expect(evaluateScheme([o(100, "nextday")], current, current)).toBeNull();
  });

  it("evaluating the current scheme against itself yields zero deltas", () => {
    const e = evaluateScheme(evenBook, current, current)!;
    expect(e.shippingRevenueDelta).toBeCloseTo(0);
    expect(e.carrierSpendDelta).toBeCloseTo(0);
    expect(e.netShippingProfitDelta).toBeCloseTo(0);
    expect(e.recoveryRate).toBeCloseTo(e.recoveryRateCurrent);
    expect(e.impact).toEqual({ newlyPaying: 0, newlyFree: 0, switchedTier: 0 });
  });

  it("excludes orders whose tier is not in the current scheme", () => {
    const e = evaluateScheme([o(50), o(50, "nextday")], current, current)!;
    expect(e.orderCount).toBe(1);
  });

  it("net delta is always fee revenue delta minus carrier cost delta", () => {
    for (const candidate of buildCandidates(evenBook, current)) {
      const e = evaluateScheme(evenBook, current, candidate.scheme)!;
      expect(e.netShippingProfitDelta).toBeCloseTo(e.shippingRevenueDelta - e.carrierSpendDelta);
    }
  });
});

describe("thresholdCurve", () => {
  it("returns one mechanical point per $10 threshold, zero at the current line", () => {
    const curve = thresholdCurve(evenBook, current);
    expect(curve.length).toBeGreaterThan(0);
    expect(curve.every((p) => typeof p.netShippingProfitDelta === "number")).toBe(true);
    const atCurrent = curve.find((p) => p.threshold === 100)!;
    expect(atCurrent.netShippingProfitDelta).toBeCloseTo(0);
  });

  it("matches evaluateScheme at the same candidate threshold", () => {
    const curve = thresholdCurve(evenBook, current);
    const point = curve.find((p) => p.threshold === 300)!;
    const direct = evaluateScheme(evenBook, current, {
      ...current,
      standard: { ...current.standard!, freeThreshold: 300 },
    })!;
    expect(point.netShippingProfitDelta).toBeCloseTo(direct.netShippingProfitDelta);
  });

  it("returns [] without analysable orders", () => {
    expect(thresholdCurve([], current)).toEqual([]);
  });
});

describe("changedTiersOf", () => {
  it("reports tiers whose fee or free threshold differ", () => {
    expect(changedTiersOf(current, current)).toEqual([]);
    expect(
      changedTiersOf(current, {
        ...current,
        standard: { ...current.standard!, freeThreshold: 200 },
      })
    ).toEqual(["standard"]);
    expect(changedTiersOf(current, { standard: current.standard })).toEqual(["express"]);
  });
});
