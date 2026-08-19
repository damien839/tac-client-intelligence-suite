import { describe, it, expect } from "vitest";
import {
  buildReconciliation,
  reconcilableOrders,
  reconciliationState,
  RECONCILIATION_TOLERANCE,
} from "@/lib/shipping-sim/reconcile";
import { evaluateScheme } from "@/lib/shipping-sim/evaluate";
import { CanonicalTier, Scheme, TaggedOrder } from "@/lib/shipping-sim/types";

function o(gross: number, shippingPaid: number, tier: CanonicalTier = "standard"): TaggedOrder {
  return { gross, shippingPaid, rawService: "x", tier };
}

const current: Scheme = {
  standard: { tier: "standard", fee: 9.95, freeThreshold: 100, avgCost: 7 },
};

describe("reconciliationState", () => {
  // REGRESSION (challenge #4): variancePct is forced to 0 when nothing was
  // collected, which rendered a green "the entered current scheme matches
  // reality" badge on summary exports and blank Shipping columns.
  it("reports 'unreconcilable' — never 'ok' — when the file records no shipping revenue", () => {
    const orders = [o(50, 0), o(60, 0)];
    const facts = evaluateScheme(orders, current, current)!;
    const reconciliation = buildReconciliation(orders, facts);

    expect(facts.shippingRevenue).toBeGreaterThan(0); // the model says they paid
    expect(reconciliation.actualShippingPaid).toBe(0); // the file says they didn't
    expect(reconciliation.variancePct).toBe(0); // raw arithmetic still reads 0
    expect(reconciliationState(reconciliation)).toBe("unreconcilable");
    expect(reconciliationState(reconciliation)).not.toBe("ok");
  });

  it("reports 'ok' when modelled revenue reproduces actual within tolerance", () => {
    const orders = [o(50, 9.95), o(60, 9.95)];
    const facts = evaluateScheme(orders, current, current)!;
    const reconciliation = buildReconciliation(orders, facts);
    expect(reconciliation.variancePct).toBeCloseTo(0);
    expect(reconciliationState(reconciliation)).toBe("ok");
  });

  it("reports 'high' once modelled revenue drifts past the tolerance", () => {
    const orders = [o(50, 2), o(60, 2)];
    const facts = evaluateScheme(orders, current, current)!;
    const reconciliation = buildReconciliation(orders, facts);
    expect(reconciliation.variancePct).toBeGreaterThan(RECONCILIATION_TOLERANCE);
    expect(reconciliationState(reconciliation)).toBe("high");
  });

  it("sits on the tolerance boundary as 'ok', not 'high'", () => {
    expect(
      reconciliationState({
        actualShippingPaid: 100,
        modelledCurrentRevenue: 110,
        variancePct: RECONCILIATION_TOLERANCE,
      })
    ).toBe("ok");
  });

  it("treats negative collected revenue as unreconcilable too", () => {
    expect(
      reconciliationState({
        actualShippingPaid: -5,
        modelledCurrentRevenue: 20,
        variancePct: 0,
      })
    ).toBe("unreconcilable");
  });
});

describe("buildReconciliation", () => {
  it("sums shipping actually paid across the orders it is given", () => {
    const orders = [o(50, 9.95), o(60, 5), o(150, 0)];
    const facts = evaluateScheme(orders, current, current)!;
    expect(buildReconciliation(orders, facts).actualShippingPaid).toBeCloseTo(14.95);
  });
});

describe("reconcilableOrders", () => {
  it("excludes orders whose tier is not in the scheme", () => {
    const orders = [o(50, 9.95), o(50, 20, "express")];
    expect(reconcilableOrders(orders, current)).toHaveLength(1);
  });
});
