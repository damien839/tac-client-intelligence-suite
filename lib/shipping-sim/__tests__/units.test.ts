import { describe, it, expect } from "vitest";
import { valueClusters, unitDrivenThresholds } from "@/lib/shipping-sim/units";
import type { ValueCluster } from "@/lib/shipping-sim/units";

// ---------------------------------------------------------------------------
// valueClusters — contract tests (Task 2)
// ---------------------------------------------------------------------------

describe("valueClusters", () => {
  // -------------------------------------------------------------------------
  // Empty / trivial inputs
  // -------------------------------------------------------------------------

  it("returns [] for empty input", () => {
    expect(valueClusters([])).toEqual([]);
  });

  it("returns [] for a single value that does not meet the density floor", () => {
    // One order at $100 → bin [100,110) has count=1 < max(3, 0.25*1) = 3
    expect(valueClusters([100])).toEqual([]);
  });

  it("returns [] when no bin meets the density floor (count >= 3)", () => {
    // 2 bins each with count=1 — well below the floor of 3
    expect(valueClusters([50, 150])).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Dominant-cluster fixture (plan contract test)
  // -------------------------------------------------------------------------

  it("dominant-cluster: 30 orders at 95–105 produce ONE cluster lo=90 hi=110, scattered singletons excluded", () => {
    // 30 orders spread across 95–105 (15 per bin spanning [90,100) and [100,110))
    const dominant: number[] = [];
    for (let i = 0; i < 15; i++) dominant.push(95 + (i % 5)); // [90,100) bin
    for (let i = 0; i < 15; i++) dominant.push(100 + (i % 5)); // [100,110) bin

    // 10 scattered orders at 200,210,...,290,300 — one per $10 bin, count=1 each
    const scattered = [200, 210, 220, 230, 240, 250, 260, 270, 280, 290];

    const grossValues = [...dominant, ...scattered];
    const clusters = valueClusters(grossValues);

    // Only ONE cluster (the two contiguous dense bins merged)
    expect(clusters).toHaveLength(1);
    expect(clusters[0].lo).toBe(90);
    expect(clusters[0].hi).toBe(110);
    expect(clusters[0].count).toBe(30);
  });

  it("dominant-cluster: scattered singleton bins are not clusters (density floor)", () => {
    const dominant: number[] = [];
    for (let i = 0; i < 15; i++) dominant.push(95 + (i % 5));
    for (let i = 0; i < 15; i++) dominant.push(100 + (i % 5));
    const scattered = [200, 210, 220, 230, 240, 250, 260, 270, 280, 290];

    const clusters = valueClusters([...dominant, ...scattered]);
    const hasScattered = clusters.some((c) => c.lo >= 200);
    expect(hasScattered).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Two separated dense bands
  // -------------------------------------------------------------------------

  it("two separated dense bands → two clusters, count-desc order", () => {
    // Band A: 20 orders in [100,110) — one bin
    const bandA = Array(20).fill(105);
    // Band B: 8 orders in [200,210) — one bin
    const bandB = Array(8).fill(205);
    // gap in [110,200) — no orders

    const clusters = valueClusters([...bandA, ...bandB]);

    expect(clusters).toHaveLength(2);
    // First cluster should be the larger one (count-desc)
    expect(clusters[0].count).toBe(20);
    expect(clusters[0].lo).toBe(100);
    expect(clusters[0].hi).toBe(110);
    expect(clusters[1].count).toBe(8);
    expect(clusters[1].lo).toBe(200);
    expect(clusters[1].hi).toBe(210);
  });

  it("two separated dense bands with equal counts — both returned, sorted by count", () => {
    const bandA = Array(10).fill(50);  // bin [50,60)
    const bandB = Array(10).fill(150); // bin [150,160)

    const clusters = valueClusters([...bandA, ...bandB]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].count).toBe(10);
    expect(clusters[1].count).toBe(10);
    // Both should be present
    const los = clusters.map((c) => c.lo).sort((a, b) => a - b);
    expect(los).toEqual([50, 150]);
  });

  // -------------------------------------------------------------------------
  // Contiguous dense bins merge
  // -------------------------------------------------------------------------

  it("three contiguous dense bins merge into a single cluster with summed count", () => {
    // Bins [50,60), [60,70), [70,80) each with 10 orders
    const values = [
      ...Array(10).fill(55),
      ...Array(10).fill(65),
      ...Array(10).fill(75),
    ];
    const clusters = valueClusters(values);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].lo).toBe(50);
    expect(clusters[0].hi).toBe(80);
    expect(clusters[0].count).toBe(30);
  });

  it("non-contiguous dense bins produce separate clusters", () => {
    // Bins [50,60) and [80,90) are dense, [60,70) and [70,80) are empty
    const values = [...Array(10).fill(55), ...Array(10).fill(85)];
    const clusters = valueClusters(values);
    expect(clusters).toHaveLength(2);
    const sorted = [...clusters].sort((a, b) => a.lo - b.lo);
    expect(sorted[0].lo).toBe(50);
    expect(sorted[0].hi).toBe(60);
    expect(sorted[1].lo).toBe(80);
    expect(sorted[1].hi).toBe(90);
  });

  // -------------------------------------------------------------------------
  // Bin edge / boundary behaviour
  // -------------------------------------------------------------------------

  it("value exactly on a $10 bin edge falls into the correct bin (lo-inclusive)", () => {
    // 10 orders at exactly $100 → bin [100,110); 10 orders at exactly $200 → bin [200,210)
    const values = [...Array(10).fill(100), ...Array(10).fill(200)];
    const clusters = valueClusters(values);
    expect(clusters).toHaveLength(2);
    const sorted = [...clusters].sort((a, b) => a.lo - b.lo);
    expect(sorted[0].lo).toBe(100);
    expect(sorted[0].hi).toBe(110);
    expect(sorted[1].lo).toBe(200);
    expect(sorted[1].hi).toBe(210);
  });

  it("value at $0 falls into bin [0,10)", () => {
    const values = Array(10).fill(0);
    const clusters = valueClusters(values);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].lo).toBe(0);
    expect(clusters[0].hi).toBe(10);
  });

  // -------------------------------------------------------------------------
  // All-identical values
  // -------------------------------------------------------------------------

  it("all-identical values produce a single cluster containing that bin", () => {
    const values = Array(50).fill(250);
    const clusters = valueClusters(values);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].lo).toBe(250);
    expect(clusters[0].hi).toBe(260);
    expect(clusters[0].count).toBe(50);
  });

  // -------------------------------------------------------------------------
  // Cap at 6 clusters
  // -------------------------------------------------------------------------

  it("caps output at 6 clusters even when more dense isolated bins exist", () => {
    // Create 10 separate dense bins with different counts (descending)
    const values: number[] = [];
    for (let i = 0; i < 10; i++) {
      const binBase = i * 100; // 0, 100, 200, ..., 900 — non-contiguous
      const count = 20 - i * 2; // 20, 18, 16, 14, 12, 10, 8, 6, 4, 2 — all >= density floor
      values.push(...Array(count).fill(binBase + 5));
    }
    const clusters = valueClusters(values);
    // Should be capped at 6
    expect(clusters.length).toBeLessThanOrEqual(6);
    // And the returned clusters should be the largest ones (count-desc)
    // The top 6 counts are: 20,18,16,14,12,10 — all >= max(3, 0.25*20)=5
    expect(clusters.length).toBe(6);
    expect(clusters[0].count).toBe(20);
    expect(clusters[5].count).toBe(10);
  });

  // -------------------------------------------------------------------------
  // Density threshold behaviour
  // -------------------------------------------------------------------------

  it("density floor is max(3, 0.25 × largest bin count)", () => {
    // Largest bin: 40 orders → floor = max(3, 10) = 10
    // A bin with 9 orders should be excluded; a bin with 10+ should be included
    const values = [
      ...Array(40).fill(50),   // bin [50,60): count=40, dense
      ...Array(9).fill(150),   // bin [150,160): count=9, NOT dense (9 < 10)
      ...Array(10).fill(250),  // bin [250,260): count=10, dense (10 >= 10)
    ];
    const clusters = valueClusters(values);
    const los = clusters.map((c) => c.lo);
    expect(los).toContain(50);
    expect(los).toContain(250);
    expect(los).not.toContain(150);
  });
});

// ---------------------------------------------------------------------------
// unitDrivenThresholds — contract tests (Task 2)
// ---------------------------------------------------------------------------

describe("unitDrivenThresholds", () => {
  // -------------------------------------------------------------------------
  // Empty / trivial inputs
  // -------------------------------------------------------------------------

  it("returns [] for empty clusters", () => {
    expect(unitDrivenThresholds([], 45)).toEqual([]);
  });

  it("returns [] for empty clusters regardless of typicalUnitPrice", () => {
    expect(unitDrivenThresholds([], 0)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Plan contract tests
  // -------------------------------------------------------------------------

  it("cluster {lo:140,hi:170,count:20} with typicalUnitPrice 45 → [215]  (170+45=215, exact $5 multiple)", () => {
    const clusters: ValueCluster[] = [{ lo: 140, hi: 170, count: 20 }];
    expect(unitDrivenThresholds(clusters, 45)).toEqual([215]);
  });

  it("cluster {lo:140,hi:170,count:20} with typicalUnitPrice 42 → [215]  (170+42=212 → rounds UP to 215)", () => {
    const clusters: ValueCluster[] = [{ lo: 140, hi: 170, count: 20 }];
    expect(unitDrivenThresholds(clusters, 42)).toEqual([215]);
  });

  it("rounds UP to next $5 multiple — never rounds down", () => {
    // hi=100, price=11 → 111 → next $5 UP = 115
    const clusters: ValueCluster[] = [{ lo: 90, hi: 100, count: 5 }];
    expect(unitDrivenThresholds(clusters, 11)).toEqual([115]);
  });

  it("value that is already an exact $5 multiple stays (no round-up)", () => {
    // hi=100, price=10 → 110 → already $5 multiple → stays 110
    const clusters: ValueCluster[] = [{ lo: 90, hi: 100, count: 5 }];
    expect(unitDrivenThresholds(clusters, 10)).toEqual([110]);
  });

  it("exact $5 multiple boundary: hi=100, price=5 → 105 → stays 105", () => {
    const clusters: ValueCluster[] = [{ lo: 90, hi: 100, count: 5 }];
    expect(unitDrivenThresholds(clusters, 5)).toEqual([105]);
  });

  // -------------------------------------------------------------------------
  // Dedupe collision
  // -------------------------------------------------------------------------

  it("dedupe: two clusters whose candidates collide produce one entry", () => {
    // Both clusters produce the same candidate after rounding
    // Cluster A: hi=100, price=10 → 110 (exact multiple)
    // Cluster B: hi=100, price=10 → 110 (same cluster hi, same candidate)
    const clusters: ValueCluster[] = [
      { lo: 90, hi: 100, count: 10 },
      { lo: 90, hi: 100, count: 8 },
    ];
    const result = unitDrivenThresholds(clusters, 10);
    expect(result).toEqual([110]);
  });

  it("dedupe: two different clusters that round to the same $5 value produce one entry", () => {
    // Cluster A: hi=100, price=11 → 111 → ceil to next $5 = 115
    // Cluster B: hi=104, price=11 → 115 → already $5 multiple → stays 115
    // Both produce 115 → dedupe to one
    const clusters: ValueCluster[] = [
      { lo: 90, hi: 100, count: 10 },
      { lo: 94, hi: 104, count: 8 },
    ];
    expect(unitDrivenThresholds(clusters, 11)).toEqual([115]);
  });

  // -------------------------------------------------------------------------
  // Sort ascending
  // -------------------------------------------------------------------------

  it("multiple clusters produce sorted ascending output", () => {
    // Cluster A: hi=200, price=10 → 210 (exact $5 multiple)
    // Cluster B: hi=100, price=10 → 110 (exact $5 multiple)
    // Cluster C: hi=300, price=10 → 310 (exact $5 multiple)
    const clusters: ValueCluster[] = [
      { lo: 190, hi: 200, count: 15 },
      { lo: 90, hi: 100, count: 10 },
      { lo: 290, hi: 300, count: 8 },
    ];
    const result = unitDrivenThresholds(clusters, 10);
    expect(result).toEqual([110, 210, 310]);
  });

  // -------------------------------------------------------------------------
  // Cap at 8
  // -------------------------------------------------------------------------

  it("caps output at 8 entries", () => {
    // Create 10 clusters with hi values 10 apart (all unique after rounding)
    const clusters: ValueCluster[] = Array.from({ length: 10 }, (_, i) => ({
      lo: i * 100,
      hi: (i * 100) + 10,
      count: 10,
    }));
    // hi values: 10, 110, 210, 310, ... 910
    // With price=5: 15, 115, 215, 315, ... 915 — all exact $5 multiples
    const result = unitDrivenThresholds(clusters, 5);
    expect(result.length).toBeLessThanOrEqual(8);
    expect(result.length).toBe(8);
    // Should be the lowest 8 (sorted asc, then capped)
    expect(result[0]).toBe(15);
    expect(result[7]).toBe(715);
  });

  // -------------------------------------------------------------------------
  // Edge: rounding at $5 boundaries
  // -------------------------------------------------------------------------

  it("rounds UP correctly: value 211 → 215 (not 210)", () => {
    // hi=200, price=11 → 211 → next $5 up = 215
    const clusters: ValueCluster[] = [{ lo: 190, hi: 200, count: 5 }];
    expect(unitDrivenThresholds(clusters, 11)).toEqual([215]);
  });

  it("rounds UP correctly: value 210 stays 210 (already $5 multiple)", () => {
    // hi=200, price=10 → 210 → exact multiple
    const clusters: ValueCluster[] = [{ lo: 190, hi: 200, count: 5 }];
    expect(unitDrivenThresholds(clusters, 10)).toEqual([210]);
  });

  it("rounds UP correctly: value 201 → 205", () => {
    // hi=200, price=1 → 201 → next $5 up = 205
    const clusters: ValueCluster[] = [{ lo: 190, hi: 200, count: 5 }];
    expect(unitDrivenThresholds(clusters, 1)).toEqual([205]);
  });

  it("rounds UP correctly: value 204 → 205", () => {
    // hi=200, price=4 → 204 → next $5 up = 205
    const clusters: ValueCluster[] = [{ lo: 190, hi: 200, count: 5 }];
    expect(unitDrivenThresholds(clusters, 4)).toEqual([205]);
  });

  it("rounds UP correctly: value 205 stays 205 (exact multiple)", () => {
    // hi=200, price=5 → 205 → exact multiple
    const clusters: ValueCluster[] = [{ lo: 190, hi: 200, count: 5 }];
    expect(unitDrivenThresholds(clusters, 5)).toEqual([205]);
  });
});
