/**
 * Deterministic per-shipment billing aggregator.
 *
 * Carrier billing exports (TGE, AusPost, StarTrack, DHL) often arrive as
 * per-shipment line items: one row per parcel, with a destination postcode
 * and a freight amount. Sending these straight to Claude is wasteful (huge
 * payload, hits the 200k token limit) AND incorrect — Claude can't look up
 * postcode → carrier-zone, so it bucketed everything into "Unknown".
 *
 * Instead, when we detect a per-shipment file, we:
 *   1. Aggregate locally by (service × postcode) — sum shipments, sum charge,
 *      sum weight.
 *   2. Resolve each postcode → carrier-zone via the postcode_zones reference
 *      table (the same one ECX uses).
 *   3. Re-aggregate by (service × resolved_zone) for the final summary rows.
 *
 * This bypasses Claude entirely for files we can handle deterministically.
 * Unknown postcodes are surfaced as warnings so the user can patch the
 * reference table or split them into a "rest" bucket.
 */
import Papa from "papaparse";

export interface ShipmentColumns {
  postcode: string;
  service: string | null;
  charge: string;
  weight: string | null;
  carrier: string | null;
  ship_date: string | null;
  consignment: string | null;
}

export interface AggregatedRow {
  carrier: string;
  service: string;
  zone: string;
  monthly_shipments: number;
  avg_charge_aud: number;
  avg_weight_kg: number | null;
  notes: string | null;
}

/**
 * One row per parcel — the line-level shape that gets persisted to
 * `shipment_lines`. Mirrors the table columns. Resolved zone is
 * denormalised at parse time so we don't need to re-join postcode_zones
 * on every analytical query.
 */
export interface ShipmentLine {
  postcode: string;
  service: string;
  resolved_zone: string;
  charge_aud: number;
  weight_kg: number | null;
  ship_date: string | null; // ISO yyyy-mm-dd
  consignment: string | null;
  raw: Record<string, string>;
}

export interface AggregateResult {
  rows: AggregatedRow[];
  lines: ShipmentLine[];
  warnings: string[];
  missing_fields: string[];
  period_label: string | null;
  carrier_code: string;
  unknown_postcode_share: number; // 0..1
}

export type PostcodeZoneMap = Map<string, string>; // postcode (4-char) → zone label

const POSTCODE_HEADER_PATTERNS = [
  "destpcode",
  "destpostcode",
  "destpostalcode",
  "destinationpostcode",
  "destpc",
  "topostcode",
  "topcode",
  "topc",
  "topostal",
  "deliverypostcode",
  "postcode",
  "postal",
  "zip",
  "zipcode",
];

// Order matters — `findHeader` iterates patterns in priority order so the
// most carrier-specific / least ambiguous match wins. Generic catch-alls
// like "description" / "desc" come last because TGE INVOIC/MTS files have
// item-description columns that would otherwise outrank PRSVDESC (the
// actual service tier — "B2C Priority", "B2C Standard").
const SERVICE_HEADER_PATTERNS = [
  "prsvdesc",            // TGE INVOIC/MTS — service tier ("B2C Priority")
  "servicedescription",
  "servicelevel",
  "servicename",
  "servicetype",
  "servicecode",
  "servdesc",
  "servicename",
  "service",
  "proddesc",
  "producttype",
  "product",
  "description",         // AusPost APVOL — service column is literally DESCRIPTION
  "desc",
];

const CHARGE_HEADER_PATTERNS = [
  "freightamt",
  "freightamount",
  "freightcharge",
  "freightcost",
  "amount",
  "charge",
  "cost",
  "totalcharge",
  "netcharge",
  "billamount",
];

const WEIGHT_HEADER_PATTERNS = [
  "chgweight",
  "chargeweight",
  "chargeableweight",
  "weight",
  "actualweight",
  "deadweight",
];

const CARRIER_HEADER_PATTERNS = ["carrier", "carriername", "carriercode"];

const SHIP_DATE_HEADER_PATTERNS = [
  "shipdate",
  "shippeddate",
  "shipmentdate",
  "despatchdate",
  "dispatchdate",
  "lodgementdate",
  "lodgeddate",
  "manifestdate",
  "pickupdate",
  "date",
];

const CONSIGNMENT_HEADER_PATTERNS = [
  "consignment",
  "consignmentnumber",
  "consignmentno",
  "consignmentid",
  "tracking",
  "trackingnumber",
  "trackingno",
  "awbnumber",
  "awbno",
  "awb",
  "articleid",
  "articlenumber",
  "labelnumber",
  "barcode",
];

const norm = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/**
 * Find a header that matches a pattern. Iterates by pattern (not header) so
 * the priority order in the pattern list determines which header wins when
 * multiple columns could match — e.g. TGE files have both PRSVDESC ("B2C
 * Priority") and a generic LINEDESC; we want the former.
 */
function findHeader(headers: string[], patterns: string[]): string | null {
  // Pass 1: exact match in priority order.
  for (const p of patterns) {
    for (const h of headers) {
      if (norm(h) === p) return h;
    }
  }
  // Pass 2: substring match in priority order.
  for (const p of patterns) {
    for (const h of headers) {
      if (norm(h).includes(p)) return h;
    }
  }
  return null;
}

export function detectShipmentColumns(
  headers: string[]
): ShipmentColumns | null {
  // Postcode + charge are the two required columns. Service is optional —
  // many AusPost / DHL exports have only one service tier per file with no
  // service column at all (they encode it in the filename or the whole file
  // is implicitly the carrier's contracted service). When missing, the
  // aggregator falls back to a single "Standard" bucket — the user can
  // rename it in the review UI before commit.
  const postcode = findHeader(headers, POSTCODE_HEADER_PATTERNS);
  const charge = findHeader(headers, CHARGE_HEADER_PATTERNS);
  if (!postcode || !charge) return null;
  return {
    postcode,
    service: findHeader(headers, SERVICE_HEADER_PATTERNS),
    charge,
    weight: findHeader(headers, WEIGHT_HEADER_PATTERNS),
    carrier: findHeader(headers, CARRIER_HEADER_PATTERNS),
    ship_date: findHeader(headers, SHIP_DATE_HEADER_PATTERNS),
    consignment: findHeader(headers, CONSIGNMENT_HEADER_PATTERNS),
  };
}

/**
 * Pads to 4 chars with leading zeros, strips non-digits. Returns null if
 * the input doesn't look like an AU postcode at all.
 */
export function normalisePostcode(raw: unknown): string | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/[^\d]/g, "");
  if (digits.length === 0 || digits.length > 4) return null;
  return digits.padStart(4, "0");
}

/**
 * Best-effort carrier inference from filename + service strings. Returns a
 * carrier code matching the public.carriers table. Falls back to "" so the
 * user can correct it in the review UI.
 */
export function inferCarrierCode(
  filename: string,
  services: string[]
): string {
  const f = filename.toLowerCase();
  if (/(^|[^a-z])tge([^a-z]|$)/.test(f) || f.includes("toll")) return "TGE";
  if (
    f.includes("auspost") ||
    f.includes("australiapost") ||
    /(^|[^a-z])ap(vol|invoice|billing|export)/.test(f) ||
    f.startsWith("ap")
  ) {
    return "AUSPOST";
  }
  if (f.includes("startrack") || /(^|[^a-z])stc([^a-z]|$)/.test(f))
    return "STARTRACK";
  if (f.includes("dhlexpress")) return "DHL_EXPRESS";
  if (f.includes("dhlecom") || f.includes("dhl")) return "DHL_ECOM";
  if (f.includes("aramex") || f.includes("fastway")) return "ARAMEX";
  if (f.includes("sendle")) return "SENDLE";
  if (f.includes("couriersplease") || f.includes("cple")) return "COURIERS_PLEASE";

  // Service-pattern fallbacks
  const joined = services.join(" ").toLowerCase();
  if (/^|\bb2c (priority|standard)/i.test(joined)) return "TGE";
  if (joined.includes("parcel post") || joined.includes("eparcel")) return "AUSPOST";
  return "";
}

export type ZoneColumnName =
  | "ap_base_zone"
  | "ap_zone_z40"
  | "toll_zone"
  | "dhl_zone"
  | "dhl_zone_name";

/**
 * Every carrier's shipment is bucketed against the same canonical AU zone
 * column — the 38-zone human-readable naming (Sydney Metro, Geelong, NT Near, …)
 * stored on `postcode_zones.dhl_zone_name`. Mirrors ECX's `postcodes.zone_name`
 * model: one zone per postcode, shared across carriers, so the postcode
 * breakdown reads consistently regardless of who shipped the parcel.
 *
 * Carrier-specific columns (toll_zone, ap_zone_z40, dhl_zone codes) still
 * exist on the reference table for future per-carrier needs, but they're
 * not used for resolution here.
 */
export function getZoneColumn(): ZoneColumnName {
  return "dhl_zone_name";
}

interface ParsedShipment {
  postcode: string;
  service: string;
  charge: number;
  weight: number | null;
  carrier: string | null;
  ship_date: string | null;
  consignment: string | null;
  raw: Record<string, string>;
}

interface ServiceZoneAcc {
  service: string;
  zone: string;
  shipments: number;
  charge_sum: number;
  charge_n: number;
  weight_sum: number;
  weight_n: number;
}

/**
 * Parses CSV text using PapaParse and returns header + rows. The text is
 * expected to be the same format produced by `fileToText` in the extract
 * route — i.e. either a raw CSV or an XLSX-converted multi-sheet CSV.
 */
export function parseRows(text: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  // Strip "### Sheet: <name>" markers we add when concatenating xlsx tabs.
  const cleaned = text.replace(/^###\s+Sheet:.*$/gm, "").trim();
  const result = Papa.parse<Record<string, string>>(cleaned, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const headers =
    result.meta.fields?.map((h) => h.trim()).filter(Boolean) ?? [];
  const rows = (result.data ?? []).filter(
    (r) => r && Object.keys(r).length > 0
  );
  return { headers, rows };
}

function parseCharge(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const cleaned = String(raw).replace(/[$,]/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseWeight(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const cleaned = String(raw).replace(/[^\d.\-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Best-effort date parsing. Carrier exports use mixed formats — ISO,
 * dd/mm/yyyy (AU), m/d/yyyy (US), Excel serials. Returns ISO yyyy-mm-dd
 * or null when we can't be confident. AU files default to dd/mm/yyyy
 * because that's what TGE/AusPost actually emit.
 */
export function parseShipDate(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (!s) return null;

  // ISO already: 2026-04-30
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // dd/mm/yyyy or dd-mm-yyyy (AU default)
  const dmy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/.exec(s);
  if (dmy) {
    const d = dmy[1].padStart(2, "0");
    const m = dmy[2].padStart(2, "0");
    let y = dmy[3];
    if (y.length === 2) y = (Number(y) >= 70 ? "19" : "20") + y;
    if (Number(d) <= 31 && Number(m) <= 12) return `${y}-${m}-${d}`;
  }

  // Excel serial (numeric, 30000–60000 range covers ~1982–2064)
  const serial = Number(s);
  if (Number.isFinite(serial) && serial > 30000 && serial < 60000) {
    // Excel epoch: 1899-12-30 (with the 1900 leap year bug already applied)
    const ms = Math.round((serial - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }

  return null;
}

/**
 * Aggregates per-shipment rows into (service × resolved_zone) summaries.
 * `postcodeZoneLookup` is invoked once per unique postcode after the first
 * pass; pass an empty map to fall back to "Unknown" for everything.
 */
export function aggregateShipments(
  rows: Record<string, string>[],
  cols: ShipmentColumns,
  postcodeZoneLookup: PostcodeZoneMap,
  carrierCode: string,
  carrierLabel: string,
  defaultService = "Standard"
): AggregateResult {
  const parsed: ParsedShipment[] = [];
  let postcodesSeen = 0;
  let postcodesParsed = 0;
  for (const row of rows) {
    postcodesSeen += 1;
    const pc = normalisePostcode(row[cols.postcode]);
    if (!pc) continue;
    const charge = parseCharge(row[cols.charge]);
    if (charge == null) continue;
    const rawService = cols.service ? (row[cols.service] ?? "").trim() : "";
    const service = rawService.length > 0 ? rawService : defaultService;
    postcodesParsed += 1;
    parsed.push({
      postcode: pc,
      service,
      charge,
      weight: cols.weight ? parseWeight(row[cols.weight]) : null,
      carrier: cols.carrier ? (row[cols.carrier] ?? "").trim() || null : null,
      ship_date: cols.ship_date ? parseShipDate(row[cols.ship_date]) : null,
      consignment: cols.consignment
        ? (row[cols.consignment] ?? "").trim() || null
        : null,
      raw: row,
    });
  }

  const byKey = new Map<string, ServiceZoneAcc>();
  let unknownZoneShipments = 0;
  const unknownPostcodes = new Set<string>();
  const lines: ShipmentLine[] = [];

  for (const r of parsed) {
    const zone = postcodeZoneLookup.get(r.postcode) ?? null;
    const zoneLabel = zone && zone.trim() ? zone.trim() : "Unknown";
    if (zoneLabel === "Unknown") {
      unknownZoneShipments += 1;
      unknownPostcodes.add(r.postcode);
    }
    lines.push({
      postcode: r.postcode,
      service: r.service,
      resolved_zone: zoneLabel,
      charge_aud: r.charge,
      weight_kg: r.weight,
      ship_date: r.ship_date,
      consignment: r.consignment,
      raw: r.raw,
    });
    const key = `${r.service}::${zoneLabel}`;
    const acc =
      byKey.get(key) ??
      ({
        service: r.service,
        zone: zoneLabel,
        shipments: 0,
        charge_sum: 0,
        charge_n: 0,
        weight_sum: 0,
        weight_n: 0,
      } as ServiceZoneAcc);
    acc.shipments += 1;
    acc.charge_sum += r.charge;
    acc.charge_n += 1;
    if (r.weight != null && Number.isFinite(r.weight)) {
      acc.weight_sum += r.weight;
      acc.weight_n += 1;
    }
    byKey.set(key, acc);
  }

  const aggregated: AggregatedRow[] = Array.from(byKey.values())
    .map((a) => ({
      carrier: carrierLabel,
      service: a.service,
      zone: a.zone,
      monthly_shipments: a.shipments,
      avg_charge_aud: a.charge_n > 0 ? a.charge_sum / a.charge_n : 0,
      avg_weight_kg: a.weight_n > 0 ? a.weight_sum / a.weight_n : null,
      notes: null,
    }))
    .sort((a, b) => b.monthly_shipments - a.monthly_shipments);

  const warnings: string[] = [];
  warnings.push(
    `Aggregated ${postcodesParsed.toLocaleString()} of ${postcodesSeen.toLocaleString()} shipment rows by (service × postcode → zone). Skipped Claude — deterministic lookup is faster and matches the ECX postcode reference.`
  );
  if (!carrierCode) {
    warnings.push(
      "Carrier could not be inferred from the filename. Pick the right carrier in the review table before committing."
    );
  } else if (unknownPostcodes.size > 0) {
    const examples = Array.from(unknownPostcodes).slice(0, 6).join(", ");
    warnings.push(
      `${unknownPostcodes.size.toLocaleString()} postcodes not found in the zone reference (e.g. ${examples}). They've been bucketed as "Unknown" — patch postcode_zones to resolve.`
    );
  }

  return {
    rows: aggregated,
    lines,
    warnings,
    missing_fields: aggregated.length === 0 ? ["zone"] : [],
    period_label: null,
    carrier_code: carrierCode,
    unknown_postcode_share:
      parsed.length === 0 ? 0 : unknownZoneShipments / parsed.length,
  };
}
