import { describe, it, expect } from "vitest";
import {
  buildCandidates,
  CANDIDATE_ROUNDING,
  CANDIDATE_ROUNDING_LOW_AOV,
  candidateRoundingFor,
  evaluateCandidates,
  percentileThresholds,
} from "@/lib/shipping-sim/candidates";
import {
  changedTiersOf,
  evaluateScheme,
  isCurrentSchemeEntered,
  thresholdCurve,
} from "@/lib/shipping-sim/evaluate";
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

  it("dedupes and handles an empty book", () => {
    expect(percentileThresholds(Array.from({ length: 10 }, () => o(200)))).toEqual([200]);
    expect(percentileThresholds([])).toEqual([]);
  });

  // REGRESSION (challenge #7a): at a flat $25 step a low-AOV book rounded every
  // candidate to $0 and the grid collapsed to nothing.
  it("drops to $5 steps on a low-AOV book instead of rounding every candidate to zero", () => {
    const cheap = [o(5), o(6), o(7)];
    expect(candidateRoundingFor(cheap.map((x) => x.gross))).toBe(CANDIDATE_ROUNDING_LOW_AOV);
    expect(percentileThresholds(cheap)).toEqual([5]);

    const cheapSpread = [o(8), o(14), o(23), o(31), o(42)];
    expect(percentileThresholds(cheapSpread)).toEqual([15, 25, 30]);
    expect(percentileThresholds(cheapSpread).every((t) => t > 0)).toBe(true);
  });

  it("keeps $25 steps once p75 reaches the low-AOV cutoff", () => {
    const normal = Array.from({ length: 20 }, (_, i) => o((i + 1) * 20)); // p75 = $320
    expect(candidateRoundingFor(normal.map((x) => x.gross))).toBe(CANDIDATE_ROUNDING);
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

  it("orders rows without Array.prototype.toSorted (Safari <16.4 has no such method)", () => {
    const source = "" + evaluateCandidates;
    expect(source).not.toContain("toSorted");
  });

  it("computes the four grid columns mechanically (hand-verified)", () => {
    // 2 orders below the current $100 line (pay $10), 2 above (free). Cost $7 each.
    const orders = [o(50), o(60), o(150), o(160)];
    const rows = evaluateCandidates(orders, current, buildCandidates(orders, current));
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

    // Everything ships free: revenue 0, cost unchanged. On this book the $50
    // free-over line already frees every order, so it is the surviving row and
    // "all-free" is dropped as an economic duplicate (challenge #7b).
    const everythingFree = byId.get("threshold-50")!;
    expect(byId.has("all-free")).toBe(false);
    expect(everythingFree.shippingRevenueDelta).toBeCloseTo(-20);
    expect(everythingFree.carrierSpendDelta).toBeCloseTo(0);
    expect(everythingFree.netShippingProfitDelta).toBeCloseTo(-20);
    expect(everythingFree.recoveryRate).toBeCloseTo(0);
    expect(everythingFree.freeOrderShare).toBeCloseTo(1);
  });

  // REGRESSION (challenge #7b): distinct schemes can be economically identical —
  // on a fee-free book every threshold collects $0 — and rendering five rows of
  // the same numbers reads as five different answers.
  it("drops rows whose revenue and carrier cost duplicate an earlier row", () => {
    const freeBook: Scheme = {
      standard: { tier: "standard", fee: 0, freeThreshold: null, avgCost: 7 },
    };
    const orders = Array.from({ length: 20 }, (_, i) => o((i + 1) * 20));
    const candidates = buildCandidates(orders, freeBook);
    expect(candidates.length).toBeGreaterThan(1); // several distinct schemes built
    const rows = evaluateCandidates(orders, freeBook, candidates);
    // Every one of them collects $0 on $0 fees, so only the baseline survives.
    expect(rows.map((r) => r.candidate.id)).toEqual(["current"]);
  });

  it("keeps rows that differ in outcome even by a small amount", () => {
    const orders = [o(50), o(60), o(150), o(160)];
    const rows = evaluateCandidates(orders, current, buildCandidates(orders, current));
    const outcomes = rows.map(
      (r) => `${r.evaluation.shippingRevenue}|${r.evaluation.carrierSpend}`
    );
    expect(new Set(outcomes).size).toBe(outcomes.length);
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
  // REGRESSION (challenge #8): the baseline came from a different summation order,
  // so the point at the current threshold read -1e-10 and the tooltip said "-$0.00".
  it("returns one mechanical point per $10 threshold, EXACTLY zero at the current line", () => {
    const curve = thresholdCurve(evenBook, current);
    expect(curve.length).toBeGreaterThan(0);
    expect(curve.every((p) => typeof p.netShippingProfitDelta === "number")).toBe(true);
    const atCurrent = curve.find((p) => p.threshold === 100)!;
    expect(atCurrent.netShippingProfitDelta).toBe(0);
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

// REGRESSION (challenge #1): step 2 auto-seeds every used tier with
// {fee: 0, freeThreshold: null}, so "the tier exists" never meant "the user
// entered it" — an untouched wizard produced a full report of +$0.00 rows.
describe("isCurrentSchemeEntered", () => {
  it("rejects the wizard's auto-seeded all-zero scheme", () => {
    expect(
      isCurrentSchemeEntered({
        standard: { tier: "standard", fee: 0, freeThreshold: null, avgCost: 7 },
        express: { tier: "express", fee: 0, freeThreshold: null, avgCost: 15 },
      })
    ).toBe(false);
  });

  it("rejects an empty scheme", () => {
    expect(isCurrentSchemeEntered({})).toBe(false);
  });

  it("accepts a scheme with a positive fee on any tier", () => {
    expect(
      isCurrentSchemeEntered({
        standard: { tier: "standard", fee: 0, freeThreshold: null, avgCost: 7 },
        express: { tier: "express", fee: 19.95, freeThreshold: null, avgCost: 15 },
      })
    ).toBe(true);
  });

  it("accepts a genuine free-shipping-everywhere scheme once a threshold is set", () => {
    expect(
      isCurrentSchemeEntered({
        standard: { tier: "standard", fee: 0, freeThreshold: 100, avgCost: 7 },
      })
    ).toBe(true);
  });

  it("accepts the fixture the rest of these tests use", () => {
    expect(isCurrentSchemeEntered(current)).toBe(true);
  });
});
