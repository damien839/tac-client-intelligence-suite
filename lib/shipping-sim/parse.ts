import Papa from "papaparse";
import { OrderRow } from "./types";

const GROSS_COLS = ["total", "total price", "total_price", "gross sales", "gross", "subtotal"];
const SHIPPING_COLS = ["shipping", "shipping paid", "shipping price", "shipping amount", "shipping_amount"];
const SERVICE_COLS = ["shipping method", "shipping_method", "service", "carrier", "shipping line", "delivery method"];

export interface ParseResult {
  orders: OrderRow[];
  services: string[]; // distinct, sorted
  errors: string[];
  warnings: string[];
}

function findCol(row: Record<string, string>, candidates: string[]): string | null {
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const hit = keys.find((k) => k === candidate);
    if (hit) return hit;
  }
  return null;
}

function toNumber(value: string | undefined): number {
  const cleaned = (value ?? "").toString().replace(/[^0-9.\-]/g, "");
  // Reject malformed values (multiple dots, stray hyphens) rather than letting
  // parseFloat silently truncate them — e.g. "1.2.3" must not become 1.2.
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return NaN;
  return parseFloat(cleaned);
}

export function parseShippingOrders(csvText: string): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim().toLowerCase(),
  });

  const rows = (parsed.data as Record<string, string>[]) ?? [];
  if (rows.length === 0) {
    errors.push("No data rows found in CSV");
    return { orders: [], services: [], errors, warnings };
  }

  const grossCol = findCol(rows[0], GROSS_COLS);
  const shipCol = findCol(rows[0], SHIPPING_COLS);
  const svcCol = findCol(rows[0], SERVICE_COLS);

  if (!grossCol) errors.push('Missing required column: gross sale (e.g. "Total")');
  if (!shipCol) errors.push('Missing required column: shipping paid (e.g. "Shipping")');
  if (!svcCol) errors.push('Missing required column: service at checkout (e.g. "Shipping Method")');
  if (errors.length > 0) return { orders: [], services: [], errors, warnings };

  const orders: OrderRow[] = [];
  const serviceSet = new Set<string>();
  let skipped = 0;

  for (const row of rows) {
    const gross = toNumber(row[grossCol!]);
    const shippingPaid = toNumber(row[shipCol!]);
    const rawService = (row[svcCol!] ?? "").trim() || "Unknown";
    if (Number.isNaN(gross)) {
      skipped += 1;
      continue;
    }
    orders.push({
      gross,
      shippingPaid: Number.isNaN(shippingPaid) ? 0 : shippingPaid,
      rawService,
    });
    serviceSet.add(rawService);
  }

  if (skipped > 0) {
    warnings.push(`${skipped} row(s) skipped — unreadable gross sale value`);
  }

  return {
    orders,
    services: Array.from(serviceSet).sort(),
    errors,
    warnings,
  };
}
