import { describe, it, expect } from "vitest";
import { parseShippingOrders } from "@/lib/shipping-sim/parse";
import type { UnitStats } from "@/lib/shipping-sim/types";

describe("parseShippingOrders", () => {
  it("parses gross, shipping paid, and service, and lists distinct services", () => {
    const csv = [
      "Total,Shipping,Shipping Method",
      "$120.00,$0.00,Standard",
      "80,15,Express",
      "200,0,Standard",
    ].join("\n");
    const r = parseShippingOrders(csv);
    expect(r.errors).toEqual([]);
    expect(r.orders).toHaveLength(3);
    expect(r.orders[0]).toEqual({ gross: 120, shippingPaid: 0, rawService: "Standard" });
    expect(r.orders[1]).toEqual({ gross: 80, shippingPaid: 15, rawService: "Express" });
    expect(r.services).toEqual(["Express", "Standard"]); // sorted, distinct
  });

  it("prefers Subtotal over Total for gross (threshold applies to merchandise, not subtotal+shipping)", () => {
    // Shopify UK/EU shape: Total = Subtotal + Shipping. Gross must be the Subtotal.
    const csv = [
      "Name,Subtotal,Shipping,Total,Shipping Method",
      "#1,128.95,30.59,159.54,Express",
      "#2,455.79,0,455.79,Free",
    ].join("\n");
    const r = parseShippingOrders(csv);
    expect(r.errors).toEqual([]);
    expect(r.orders[0].gross).toBe(128.95);
    expect(r.orders[1].gross).toBe(455.79);
    // Subtotal is not a total-type column, so no shipping-bundling warning.
    expect(r.warnings.some((w) => w.includes("includes shipping"))).toBe(false);
  });

  it("warns when it falls back to a Total column alongside a Shipping column", () => {
    const csv = ["Total,Shipping,Shipping Method", "159.54,30.59,Express"].join("\n");
    const r = parseShippingOrders(csv);
    expect(r.orders[0].gross).toBe(159.54); // best available
    expect(r.warnings.some((w) => w.includes("includes shipping"))).toBe(true);
  });

  it("errors when a required column is missing", () => {
    const csv = ["Total,Shipping", "120,0"].join("\n");
    const r = parseShippingOrders(csv);
    expect(r.orders).toHaveLength(0);
    expect(r.errors.some((e) => e.includes("service"))).toBe(true);
  });

  it("skips rows with unreadable gross and warns", () => {
    const csv = ["Total,Shipping,Shipping Method", "abc,5,Standard", "100,5,Standard"].join("\n");
    const r = parseShippingOrders(csv);
    expect(r.orders).toHaveLength(1);
    expect(r.warnings.some((w) => w.includes("skipped"))).toBe(true);
  });

  it("rejects malformed multi-decimal gross rather than truncating it", () => {
    const csv = ["Total,Shipping,Shipping Method", "1.2.3,5,Standard", "100,5,Standard"].join("\n");
    const r = parseShippingOrders(csv);
    expect(r.orders).toHaveLength(1); // the 1.2.3 row is skipped, not parsed as 1.2
    expect(r.orders[0].gross).toBe(100);
    expect(r.warnings.some((w) => w.includes("skipped"))).toBe(true);
  });

  it("errors on a header-only CSV with no data rows", () => {
    const r = parseShippingOrders("Total,Shipping,Shipping Method");
    expect(r.orders).toHaveLength(0);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("defaults a blank service to 'Unknown'", () => {
    const csv = ["Total,Shipping,Shipping Method", "100,5,"].join("\n");
    const r = parseShippingOrders(csv);
    expect(r.orders[0].rawService).toBe("Unknown");
  });
});

// ---------------------------------------------------------------------------
// Full-export (line-item) mode — contract tests (Task 1)
// ---------------------------------------------------------------------------

const FULL = [
  "Name,Total,Shipping,Shipping Method,Lineitem quantity,Lineitem price",
  "#1001,150.00,9.95,Standard Shipping,1,80.00",
  "#1001,,,,2,30.00", // second line item of #1001 — continuation row
  "#1002,90.00,9.95,Standard Shipping,1,90.00",
  "#1003,300.00,0.00,Express Shipping,3,100.00",
].join("\n");

describe("parseShippingOrders — full-export mode", () => {
  it("parses 3 orders (not 5 rows), groups continuation rows correctly", () => {
    const r = parseShippingOrders(FULL);
    expect(r.errors).toEqual([]);
    expect(r.orders).toHaveLength(3);
  });

  it("#1001 has units:3 and gross 150", () => {
    const r = parseShippingOrders(FULL);
    const o1001 = r.orders.find((o) => o.rawService === "Standard Shipping" && o.gross === 150);
    expect(o1001).toBeDefined();
    expect(o1001!.units).toBe(3);
  });

  it("#1003 has units:3", () => {
    const r = parseShippingOrders(FULL);
    const o1003 = r.orders.find((o) => o.rawService === "Express Shipping");
    expect(o1003).toBeDefined();
    expect(o1003!.units).toBe(3);
  });

  it("services are sorted and distinct — no blank continuation row service", () => {
    const r = parseShippingOrders(FULL);
    expect(r.services).toEqual(["Express Shipping", "Standard Shipping"]);
  });

  it("no skipped-row warning for blank continuation rows", () => {
    const r = parseShippingOrders(FULL);
    const skipWarning = r.warnings.find((w) => w.toLowerCase().includes("skip"));
    expect(skipWarning).toBeUndefined();
  });

  it("typicalUnitPrice is 90 (qty-weighted median of 80×1, 30×2, 90×1, 100×3)", () => {
    const r = parseShippingOrders(FULL);
    expect(r.unitStats).not.toBeNull();
    expect((r.unitStats as UnitStats).typicalUnitPrice).toBe(90);
  });

  it("unitShare is {single:1/3, double:0, threePlus:2/3}", () => {
    const r = parseShippingOrders(FULL);
    const stats = r.unitStats as UnitStats;
    expect(stats.ordersWithUnits).toBe(3);
    expect(stats.unitShare.single).toBeCloseTo(1 / 3);
    expect(stats.unitShare.double).toBeCloseTo(0);
    expect(stats.unitShare.threePlus).toBeCloseTo(2 / 3);
  });

  it("order with every row having unparseable gross is skipped with a warning", () => {
    const csvWithBadOrder = [
      "Name,Total,Shipping,Shipping Method,Lineitem quantity,Lineitem price",
      "#1001,150.00,9.95,Standard Shipping,1,80.00",
      "#BADORDER,abc,5,Standard Shipping,1,50.00",
      "#BADORDER,,,,,", // also bad
    ].join("\n");
    const r = parseShippingOrders(csvWithBadOrder);
    expect(r.orders).toHaveLength(1);
    expect(r.warnings.some((w) => w.includes("1"))).toBe(true); // 1 order skipped
  });
});

// ---------------------------------------------------------------------------
// Pinned-behaviour tests (Task 2 review follow-ups)
// ---------------------------------------------------------------------------

describe("parseShippingOrders — pinned parser behaviours", () => {
  it("weighted median picks the lower middle unit for even total quantity", () => {
    const csv = [
      "Name,Total,Shipping,Shipping Method,Lineitem quantity,Lineitem price",
      "#1,40.00,5.00,Standard,2,10.00",
      "#2,220.00,5.00,Standard,2,100.00",
    ].join("\n");
    // totalQty=4, midpoint=ceil(4/2)=2; cumulative after price=10 pair is 2 >= 2 → lower median
    expect(parseShippingOrders(csv).unitStats!.typicalUnitPrice).toBe(10);
  });

  it("orders with no parseable quantities still count toward ordersWithUnits (pinned behaviour)", () => {
    const csv = [
      "Name,Total,Shipping,Shipping Method,Lineitem quantity,Lineitem price",
      "#1,40.00,5.00,Standard,abc,10.00",
      "#2,90.00,5.00,Standard,1,90.00",
    ].join("\n");
    const s = parseShippingOrders(csv).unitStats!;
    // Current convention: zero-unit orders stay in the denominator (ordersWithUnits = all grouped orders)
    expect(s.ordersWithUnits).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Summary mode — existing ParseResult gains unitStats: null
// ---------------------------------------------------------------------------

describe("parseShippingOrders — summary mode unitStats null", () => {
  it("summary CSV returns unitStats: null", () => {
    const csv = [
      "Total,Shipping,Shipping Method",
      "$120.00,$0.00,Standard",
      "80,15,Express",
    ].join("\n");
    const r = parseShippingOrders(csv);
    expect(r.unitStats).toBeNull();
  });

  it("summary CSV still parses orders identically to before", () => {
    const csv = [
      "Total,Shipping,Shipping Method",
      "$120.00,$0.00,Standard",
      "80,15,Express",
      "200,0,Standard",
    ].join("\n");
    const r = parseShippingOrders(csv);
    expect(r.errors).toEqual([]);
    expect(r.orders).toHaveLength(3);
    expect(r.orders[0]).toEqual({ gross: 120, shippingPaid: 0, rawService: "Standard" });
    expect(r.orders[1]).toEqual({ gross: 80, shippingPaid: 15, rawService: "Express" });
    expect(r.services).toEqual(["Express", "Standard"]);
  });
});
