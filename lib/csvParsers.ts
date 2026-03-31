/**
 * CSV Parsing utilities for Shopify order exports and carrier/warehouse data.
 * Uses Papa Parse for robust CSV handling.
 */

import Papa from "papaparse";
import { OrderRow } from "./calculations";

/**
 * Parse a Shopify orders CSV export into OrderRow[].
 * Handles common column name variations.
 */
export function parseShopifyOrders(csvText: string): {
  orders: OrderRow[];
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim().toLowerCase(),
  });

  if (parsed.errors.length > 0) {
    errors.push(...parsed.errors.map((e) => `Row ${e.row}: ${e.message}`));
  }

  const rows = parsed.data as Record<string, string>[];
  if (rows.length === 0) {
    errors.push("No data rows found in CSV");
    return { orders: [], errors, warnings };
  }

  // Column name mapping (handle variations)
  const colMap = {
    orderId: findCol(rows[0], [
      "name",
      "order name",
      "order_name",
      "order id",
      "order_id",
      "#",
    ]),
    createdAt: findCol(rows[0], [
      "created at",
      "created_at",
      "date",
      "order date",
    ]),
    totalPrice: findCol(rows[0], [
      "total",
      "total price",
      "total_price",
      "subtotal",
      "order total",
    ]),
    shippingCollected: findCol(rows[0], [
      "shipping",
      "shipping collected",
      "shipping_collected",
      "shipping price",
    ]),
    lineItemQty: findCol(rows[0], [
      "lineitem quantity",
      "lineitem_quantity",
      "quantity",
      "line item quantity",
      "qty",
    ]),
    carrierService: findCol(rows[0], [
      "shipping method",
      "shipping_method",
      "carrier",
      "carrier service",
      "service level",
      "service",
      "shipping line title",
    ]),
    netPayment: findCol(rows[0], [
      "net payment",
      "net_payment",
      "payment",
      "amount paid",
    ]),
  };

  // Validate required columns
  if (!colMap.totalPrice) {
    errors.push(
      'Required column not found: "Total" or "Total Price". Available columns: ' +
        Object.keys(rows[0]).join(", ")
    );
    return { orders: [], errors, warnings };
  }

  if (!colMap.shippingCollected) {
    warnings.push(
      'Shipping collected column not found — defaulting to $0. Look for "Shipping" column.'
    );
  }

  if (!colMap.carrierService) {
    warnings.push(
      "Carrier/service level column not found — carrier split analysis will be unavailable."
    );
  }

  // Parse rows
  const orders: OrderRow[] = [];
  const seenOrders = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const orderId = colMap.orderId ? row[colMap.orderId]?.trim() || `row-${i}` : `row-${i}`;

    // Shopify exports have multiple rows per order (one per line item)
    // Aggregate by order ID
    if (seenOrders.has(orderId)) {
      // Find existing order and add line item qty
      const existing = orders.find((o) => o.orderId === orderId);
      if (existing && colMap.lineItemQty) {
        existing.lineItemQty += parseFloat(row[colMap.lineItemQty] || "0") || 0;
      }
      continue;
    }
    seenOrders.add(orderId);

    const totalPrice = parseDollar(colMap.totalPrice ? row[colMap.totalPrice] : "0");
    if (totalPrice <= 0) continue; // Skip $0 or negative orders

    orders.push({
      orderId,
      createdAt: colMap.createdAt ? row[colMap.createdAt]?.trim() || "" : "",
      totalPrice,
      shippingCollected: parseDollar(
        colMap.shippingCollected ? row[colMap.shippingCollected] : "0"
      ),
      lineItemQty: colMap.lineItemQty
        ? parseFloat(row[colMap.lineItemQty] || "1") || 1
        : 1,
      carrierService: colMap.carrierService
        ? row[colMap.carrierService]?.trim() || "Unknown"
        : "Unknown",
      netPayment: colMap.netPayment
        ? parseDollar(row[colMap.netPayment])
        : totalPrice,
    });
  }

  if (orders.length === 0) {
    errors.push("No valid orders found after parsing. Check that Total Price column has numeric values.");
  }

  return { orders, errors, warnings };
}

/**
 * Parse carrier invoice CSV for Module 2.
 */
export interface CarrierInvoiceRow {
  carrier: string;
  service: string;
  shipments: number;
  avgCost: number;
  zone: string;
}

export function parseCarrierInvoice(csvText: string): {
  rows: CarrierInvoiceRow[];
  errors: string[];
} {
  const errors: string[] = [];
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim().toLowerCase(),
  });

  const data = parsed.data as Record<string, string>[];
  const rows: CarrierInvoiceRow[] = [];

  for (const row of data) {
    rows.push({
      carrier: row["carrier"] || row["provider"] || "Unknown",
      service: row["service"] || row["service level"] || row["service_level"] || "Standard",
      shipments: parseInt(row["shipments"] || row["count"] || row["#"] || "0") || 0,
      avgCost: parseDollar(row["avg cost"] || row["average cost"] || row["cost"] || "0"),
      zone: row["zone"] || row["region"] || "",
    });
  }

  return { rows, errors };
}

/**
 * Parse warehouse cost CSV for Module 2.
 */
export interface WarehouseCostRow {
  category: string;
  monthlyCost: number;
  perUnitCost: number;
}

export function parseWarehouseCost(csvText: string): {
  rows: WarehouseCostRow[];
  errors: string[];
} {
  const errors: string[] = [];
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim().toLowerCase(),
  });

  const data = parsed.data as Record<string, string>[];
  const rows: WarehouseCostRow[] = [];

  for (const row of data) {
    rows.push({
      category: row["category"] || row["cost category"] || row["type"] || "Unknown",
      monthlyCost: parseDollar(
        row["monthly"] || row["monthly cost"] || row["monthly $"] || "0"
      ),
      perUnitCost: parseDollar(
        row["per unit"] || row["per unit cost"] || row["per-unit $"] || row["unit cost"] || "0"
      ),
    });
  }

  return { rows, errors };
}

// ─── Helpers ────────────────────────────────────────────────────────

function findCol(
  row: Record<string, string>,
  candidates: string[]
): string | null {
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const found = keys.find((k) => k === candidate);
    if (found) return found;
  }
  // Fuzzy match
  for (const candidate of candidates) {
    const found = keys.find((k) => k.includes(candidate));
    if (found) return found;
  }
  return null;
}

function parseDollar(value: string | undefined): number {
  if (!value) return 0;
  const cleaned = value.replace(/[$,\s]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}
