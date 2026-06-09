import { describe, it, expect } from "vitest";
import { analyze } from "@/lib/shipping-sim/analysis";
import { Scheme, TaggedOrder } from "@/lib/shipping-sim/types";

const std = { tier: "standard" as const, fee: 9.95, freeThreshold: 100, avgCost: 8 };
const exp = { tier: "express" as const, fee: 14.95, freeThreshold: 200, avgCost: 13 };
const current: Scheme = { standard: std, express: exp };
const proposed: Scheme = {
  standard: { tier: "standard", fee: 12, freeThreshold: 150, avgCost: 8 },
  express: { tier: "express", fee: 20, freeThreshold: 250, avgCost: 13 },
};
const o = (gross: number, tier: TaggedOrder["tier"], shippingPaid = 0): TaggedOrder => ({ gross, shippingPaid, rawService: "x", tier });

const sample: TaggedOrder[] = [
  o(120, "standard", 0), o(85.5, "standard", 9.95), o(210, "express", 0), o(65, "standard", 9.95),
  o(175, "express", 14.95), o(95, "standard", 9.95), o(250, "express", 0), o(45, "standard", 9.95),
];

describe("analyze", () => {
  it("computes cost recovery rates", () => {
    const a = analyze(sample, current, proposed);
    expect(a.recoveryCurrent).toBeCloseTo(54.75 / 79, 5);
    expect(a.recoveryProposed).toBeCloseTo(60 / 69, 5);
  });

  it("guards recovery when carrier spend is 0", () => {
    const zero: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: null, avgCost: 0 } };
    const a = analyze([o(50, "standard")], zero, zero);
    expect(a.recoveryCurrent).toBe(0);
    expect(a.recoveryProposed).toBe(0);
  });

  it("flags moved orders and computes net delta", () => {
    const a = analyze(sample, current, proposed);
    expect(a.movedCount).toBe(2);
    const movedGrosses = a.movement.filter((m) => m.moved).map((m) => m.gross).sort((x, y) => x - y);
    expect(movedGrosses).toEqual([175, 210]);
    const m210 = a.movement.find((m) => m.gross === 210)!;
    expect(m210.landedTier).toBe("standard");
    // chosen express @210: free (0) - carrier 13 = -13; landed standard @210: free (0) - carrier 8 = -8; delta = +5
    expect(m210.netDelta).toBe(5);
  });

  it("aggregates per-tier economics current and proposed", () => {
    const a = analyze(sample, current, proposed);
    expect(a.tierEconomicsCurrent.find((t) => t.tier === "standard")!.count).toBe(5);
    expect(a.tierEconomicsProposed.find((t) => t.tier === "standard")!.count).toBe(7);
    expect(a.tierEconomicsProposed.find((t) => t.tier === "express")!.count).toBe(1);
  });

  it("counts free orders and free-shipping subsidy", () => {
    const a = analyze(sample, current, proposed);
    expect(a.freeOrdersCurrent).toBe(3); // 120 std, 210 exp, 250 exp
    expect(a.subsidyCurrent).toBe(8 + 13 + 13); // 34
  });

  it("produces a threshold sweep and selects the optimum", () => {
    const a = analyze(sample, current, proposed, { sweepMax: 400, sweepStep: 10 });
    expect(a.thresholdSweep.length).toBe(41); // 0..400 inclusive
    expect(a.thresholdSweep[0].threshold).toBe(0);
    expect(a.optimalNet).toBe(Math.max(...a.thresholdSweep.map((p) => p.netShippingProfit)));
  });

  it("computes net delta per order and guards empty input", () => {
    const a = analyze(sample, current, proposed);
    expect(a.netDeltaPerOrder).toBeCloseTo(a.benchmark.netProfitDelta / 8, 5);
    const empty = analyze([], current, proposed);
    expect(empty.netDeltaPerOrder).toBe(0);
    expect(empty.movedCount).toBe(0);
  });
});
