import { describe, it, expect } from "vitest";
import { parseShippingOrders } from "@/lib/shipping-sim/parse";

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
