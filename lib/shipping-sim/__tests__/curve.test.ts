import { describe, it, expect } from "vitest";
import { curveStats } from "@/lib/shipping-sim/curve";
import { CanonicalTier, Scheme, TaggedOrder } from "@/lib/shipping-sim/types";

function o(gross: number, tier: CanonicalTier = "express"): TaggedOrder {
  return { gross, shippingPaid: 0, rawService: "x", tier };
}

// Flat express tier (Park-Noire-shaped): single tier, $30 fee, free over $250.
const overThreshold: Scheme = {
  express: { tier: "express", fee: 30, freeThreshold: 250, avgCost: 22 },
};
// Truly flat: a fee that never goes free.
const flat: Scheme = {
  express: { tier: "express", fee: 30, freeThreshold: null, avgCost: 22 },
};

describe("curveStats — basics", () => {
  it("returns a finite zeroed result for an empty book", () => {
    const s = curveStats([], overThreshold, "express");
    expect(s.count).toBe(0);
    expect(s.mean).toBe(0);
    expect(s.pullZone).toBeNull();
    expect(s.histogram).toEqual([]);
  });

  it("computes mean, median, min, max on a known sample", () => {
    const s = curveStats([o(100), o(200), o(300)], overThreshold, "express");
    expect(s.count).toBe(3);
    expect(s.mean).toBeCloseTo(200, 6);
    expect(s.median).toBeCloseTo(200, 6);
    expect(s.min).toBe(100);
    expect(s.max).toBe(300);
    expect(s.stdev).toBeCloseTo(Math.sqrt((100 ** 2 + 0 + 100 ** 2) / 3), 6);
  });

  it("handles a single order without NaN", () => {
    const s = curveStats([o(150)], overThreshold, "express");
    expect(s.count).toBe(1);
    expect(s.mean).toBe(150);
    expect(s.median).toBe(150);
    expect(s.percentiles.p10).toBe(150);
    expect(s.percentiles.p99).toBe(150);
    expect(Number.isNaN(s.stdev)).toBe(false);
    expect(s.stdev).toBe(0);
  });

  it("handles an all-same-value book (zero variance, zero skew)", () => {
    const s = curveStats([o(100), o(100), o(100)], overThreshold, "express");
    expect(s.stdev).toBe(0);
    expect(s.skewPct).toBeCloseTo(0, 6);
  });
});

describe("curveStats — percentiles + skew", () => {
  it("interpolates percentiles linearly", () => {
    // 0..100 in tens → 11 points; p50 = 50, p90 = 90.
    const orders = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((g) => o(g));
    const s = curveStats(orders, flat, "express");
    expect(s.median).toBeCloseTo(50, 6);
    expect(s.percentiles.p90).toBeCloseTo(90, 6);
    expect(s.percentiles.p25).toBeCloseTo(25, 6);
  });

  it("reports a positive skew when the mean sits above the median", () => {
    // Right-skewed: bulk low, one big tail order.
    const orders = [o(100), o(100), o(100), o(100), o(900)];
    const s = curveStats(orders, flat, "express");
    expect(s.mean).toBeGreaterThan(s.median);
    expect(s.skewPct).toBeGreaterThan(0);
    expect(s.skewPct).toBeCloseTo((s.mean / s.median - 1) * 100, 6);
  });
});

describe("curveStats — histogram", () => {
  it("bins into $25 bands with an open-ended tail", () => {
    const s = curveStats([o(10), o(30), o(60)], flat, "express");
    const last = s.histogram[s.histogram.length - 1];
    expect(last.hi).toBeNull();
    // Total across bands equals the sample size.
    expect(s.histogram.reduce((t, b) => t + b.n, 0)).toBe(3);
  });

  it("places a value exactly on a band boundary in the upper band", () => {
    const s = curveStats([o(25)], flat, "express");
    const band0 = s.histogram.find((b) => b.lo === 0)!;
    const band25 = s.histogram.find((b) => b.lo === 25)!;
    expect(band0.n).toBe(0);
    expect(band25.n).toBe(1);
  });
});

describe("curveStats — price points", () => {
  it("tallies exact subtotals, most common first, capped at 12", () => {
    const orders = [
      ...Array(5).fill(0).map(() => o(118.95)),
      ...Array(3).fill(0).map(() => o(98.97)),
      o(250.0),
    ];
    const s = curveStats(orders, overThreshold, "express");
    expect(s.pricePoints[0]).toEqual({ value: 118.95, n: 5 });
    expect(s.pricePoints[1]).toEqual({ value: 98.97, n: 3 });
    expect(s.pricePoints.length).toBeLessThanOrEqual(12);
  });
});

describe("curveStats — pull zone", () => {
  it("is null when the dominant tier is flat (no threshold)", () => {
    const s = curveStats([o(100), o(200)], flat, "express");
    expect(s.pullZone).toBeNull();
  });

  it("is null when there is no dominant tier", () => {
    const s = curveStats([o(100)], overThreshold, null);
    expect(s.pullZone).toBeNull();
  });

  it("bands $5-wide across the current line ±$50", () => {
    const orders = [o(230), o(245), o(255), o(270)];
    const s = curveStats(orders, overThreshold, "express");
    expect(s.pullZone).not.toBeNull();
    expect(s.pullZone!.threshold).toBe(250);
    // Range 200..300, $5 bands → 20 bands.
    expect(s.pullZone!.bands.length).toBe(20);
    const band245 = s.pullZone!.bands.find((b) => b.lo === 245)!;
    expect(band245.n).toBe(1); // the $245 order
    expect(s.pullZone!.bands.reduce((t, b) => t + b.n, 0)).toBe(4);
  });
});

describe("curveStats — shipping load + free/paid split", () => {
  it("reads 0% load for bands at/above the free line, positive below", () => {
    const orders = [o(100), o(275)];
    const s = curveStats(orders, overThreshold, "express");
    const below = s.shippingLoad.find((b) => b.lo === 100)!; // $100 < 250 → pays $30
    const above = s.shippingLoad.find((b) => b.lo === 275)!; // $275 ≥ 250 → free
    expect(below.loadPct).toBeCloseTo((30 / 100) * 100, 6); // weighted on actual gross
    expect(above.loadPct).toBe(0);
  });

  it("splits free vs paid AOV by the current scheme", () => {
    // $100 pays (below 250), $400 free (above 250).
    const s = curveStats([o(100), o(400)], overThreshold, "express");
    expect(s.paidN).toBe(1);
    expect(s.freeN).toBe(1);
    expect(s.paidAov).toBeCloseTo(100, 6);
    expect(s.freeAov).toBeCloseTo(400, 6);
  });

  it("computes shipping revenue as a share of GMV", () => {
    // Both pay $30; GMV = 100 + 200 = 300; rev = 60 → 20%.
    const s = curveStats([o(100), o(200)], flat, "express");
    expect(s.shipRevPctGmv).toBeCloseTo((60 / 300) * 100, 6);
  });
});
