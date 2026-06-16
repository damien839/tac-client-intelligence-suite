import Papa from "papaparse";
import { OrderRow, UnitStats } from "./types";

// Gross = the merchandise cart value the free-ship threshold applies to (pre-shipping).
// Prefer subtotal/gross-sales; fall back to total-type columns only when nothing better
// exists. A "Total" that bundles shipping would otherwise shift the whole curve up and
// mis-classify orders around the threshold (the reconciliation gate can sit under 10% and
// miss it — see the UK/EU export, 2026-06-17).
const GROSS_COLS = ["subtotal", "gross sales", "gross", "total price", "total_price", "total"];
const TOTAL_LIKE_COLS = ["total", "total price", "total_price"];
const SHIPPING_COLS = ["shipping", "shipping paid", "shipping price", "shipping amount", "shipping_amount"];
const SERVICE_COLS = ["shipping method", "shipping_method", "service", "carrier", "shipping line", "delivery method"];
const NAME_COL = "name";
const LINEITEM_QTY_COL = "lineitem quantity";
const LINEITEM_PRICE_COL = "lineitem price";

export interface ParseResult {
  orders: OrderRow[];
  services: string[]; // distinct, sorted
  errors: string[];
  warnings: string[];
  unitStats: UnitStats | null; // null in summary mode or when no usable line items
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

/** Quantity-weighted median of (price, qty) pairs.
 * Sort pairs by price, walk cumulative qty to ceil(totalQty/2).
 * Does NOT materialise the expanded array. */
function weightedMedianPrice(pairs: Array<{ price: number; qty: number }>): number {
  if (pairs.length === 0) return 0;

  // Sort by price ascending
  const sorted = [...pairs].sort((a, b) => a.price - b.price);

  const totalQty = sorted.reduce((sum, p) => sum + p.qty, 0);
  if (totalQty === 0) return 0;

  const midpoint = Math.ceil(totalQty / 2);
  let cumulative = 0;

  for (const pair of sorted) {
    cumulative += pair.qty;
    if (cumulative >= midpoint) {
      return pair.price;
    }
  }

  // Should never reach here
  return sorted[sorted.length - 1].price;
}

/** Parse full-export (line-item grouped) mode. */
function parseFullExport(
  rows: Record<string, string>[],
  grossCol: string,
  shipCol: string,
  svcCol: string,
): { orders: OrderRow[]; services: string[]; warnings: string[]; unitStats: UnitStats | null } {
  const warnings: string[] = [];

  // Group rows by name (preserving insertion order)
  const groups = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    const name = (row[NAME_COL] ?? "").trim();
    if (!name) continue; // skip rows without a name (shouldn't happen in well-formed exports)
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(row);
  }

  const orders: OrderRow[] = [];
  const serviceSet = new Set<string>();
  let skippedOrders = 0;
  let hadUnparseableQty = false;

  // Per-order unit data for stats
  const allPairs: Array<{ price: number; qty: number }> = [];
  const perOrderUnits: number[] = [];

  for (const [, groupRows] of Array.from(groups.entries())) {
    // Find the order row: the row where gross parses
    let gross: number = NaN;
    let shippingPaid: number = 0;
    let rawService: string = "Unknown";

    for (const row of groupRows) {
      const g = toNumber(row[grossCol]);
      if (!Number.isNaN(g)) {
        gross = g;
        const s = toNumber(row[shipCol]);
        shippingPaid = Number.isNaN(s) ? 0 : s;
        rawService = (row[svcCol] ?? "").trim() || "Unknown";
        break;
      }
    }

    if (Number.isNaN(gross)) {
      skippedOrders += 1;
      continue;
    }

    // Aggregate line-item quantities and prices
    let totalUnits = 0;
    const orderPairs: Array<{ price: number; qty: number }> = [];

    for (const row of groupRows) {
      const qty = toNumber(row[LINEITEM_QTY_COL]);
      const price = toNumber(row[LINEITEM_PRICE_COL]);

      if (Number.isNaN(qty)) {
        hadUnparseableQty = true;
        // Contributes 0 to units
      } else {
        totalUnits += qty;
        if (!Number.isNaN(price) && price >= 0) {
          orderPairs.push({ price, qty });
        }
      }
    }

    const order: OrderRow = {
      gross,
      shippingPaid,
      rawService,
      units: totalUnits,
    };

    orders.push(order);
    serviceSet.add(rawService);
    perOrderUnits.push(totalUnits);
    allPairs.push(...orderPairs);
  }

  if (skippedOrders > 0) {
    warnings.push(
      `${skippedOrders} order(s) skipped — no parseable gross sale value`,
    );
  }

  if (hadUnparseableQty) {
    warnings.push("Some line-item quantities were unreadable and contributed 0 to unit counts");
  }

  // Build unitStats
  const unitStats = buildUnitStats(perOrderUnits, allPairs);

  return {
    orders,
    services: Array.from(serviceSet).sort(),
    warnings,
    unitStats,
  };
}

/** Build UnitStats from per-order unit counts and all price/qty pairs. */
function buildUnitStats(
  perOrderUnits: number[],
  pairs: Array<{ price: number; qty: number }>,
): UnitStats | null {
  if (pairs.length === 0) return null;

  const ordersWithUnits = perOrderUnits.length;
  if (ordersWithUnits === 0) return null;

  // unitShare by orders-with-units denominator
  let single = 0;
  let double = 0;
  let threePlus = 0;

  for (const units of perOrderUnits) {
    if (units === 1) single += 1;
    else if (units === 2) double += 1;
    else if (units >= 3) threePlus += 1;
    // units === 0 contribute to ordersWithUnits count but not to any band
  }

  const denom = ordersWithUnits;

  return {
    typicalUnitPrice: weightedMedianPrice(pairs),
    ordersWithUnits,
    unitShare: {
      single: single / denom,
      double: double / denom,
      threePlus: threePlus / denom,
    },
  };
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
    return { orders: [], services: [], errors, warnings, unitStats: null };
  }

  const grossCol = findCol(rows[0], GROSS_COLS);
  const shipCol = findCol(rows[0], SHIPPING_COLS);
  const svcCol = findCol(rows[0], SERVICE_COLS);

  if (!grossCol) errors.push('Missing required column: gross sale (e.g. "Total")');
  if (!shipCol) errors.push('Missing required column: shipping paid (e.g. "Shipping")');
  if (!svcCol) errors.push('Missing required column: service at checkout (e.g. "Shipping Method")');
  if (errors.length > 0) return { orders: [], services: [], errors, warnings, unitStats: null };

  // Fell back to a total-type column while a shipping column exists: the order value may
  // include shipping, which distorts AOV and the free-ship threshold comparison.
  if (grossCol && shipCol && TOTAL_LIKE_COLS.includes(grossCol)) {
    warnings.push(
      `Using "${grossCol}" as the order value — if it includes shipping, AOV and the free-ship ` +
        `threshold may be off. Provide a "Subtotal" column for accuracy.`
    );
  }

  // Detect full-export mode: headers include name + lineitem quantity + lineitem price
  const headers = Object.keys(rows[0]);
  const isFullExport =
    headers.includes(NAME_COL) &&
    headers.includes(LINEITEM_QTY_COL) &&
    headers.includes(LINEITEM_PRICE_COL);

  if (isFullExport) {
    const result = parseFullExport(rows, grossCol!, shipCol!, svcCol!);
    return {
      orders: result.orders,
      services: result.services,
      errors,
      warnings: [...warnings, ...result.warnings],
      unitStats: result.unitStats,
    };
  }

  // Summary mode — original behaviour, byte-identical to before
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
    unitStats: null,
  };
}
