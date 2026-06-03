import { NextResponse } from "next/server";
import { getAnthropic } from "@/lib/analyzer/anthropic";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  lookupCanonicalTier,
  resolveCanonicalTiers,
} from "@/lib/freight/canonical-tier-server";
import {
  aggregateShipments,
  detectShipmentColumns,
  getZoneColumn,
  inferCarrierCode,
  parseRows,
  type PostcodeZoneMap,
  type ShipmentLine,
} from "@/lib/freight/shipment-aggregator";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 15 * 1024 * 1024;
const MODEL = "claude-sonnet-4-5";

interface ExtractedRow {
  carrier: string;
  service: string;
  zone: string;
  monthly_shipments: number | null;
  avg_charge_aud: number | null;
  avg_weight_kg: number | null;
  notes: string | null;
}

interface PersistResult {
  upload_id: string;
  carrier_id: string | null;
  carrier_code: string;
  lines_written: number;
}

interface ExtractResponse {
  rows: ExtractedRow[];
  period_label: string | null;
  warnings: string[];
  missing_fields: string[];
  persisted: PersistResult | null;
  meta: {
    model: string;
    file_name: string;
    file_size: number;
    file_type: string;
  };
}

const SYSTEM_PROMPT = `You extract monthly shipment volume + charge data from carrier invoices, 3PL billing reports, or warehouse export sheets.

Return STRICT JSON only — no prose, no markdown fences.

Output shape:
{
  "rows": [
    {
      "carrier": string,                 // e.g. "Australia Post", "StarTrack", "Aramex"
      "service": string,                 // e.g. "Express", "Standard", "Next Day", "Same Day", "International Express", "International Standard"
      "zone": string,                    // EXACT source zone code/label as it appears in the file. AusPost: "B0","B1","B2","B3","N0","N1","N2","N3","Z40","Z9","Z6"; StarTrack/Toll: "Metro","Country","Same City","Inter Capital"; carrier-specific: "Zone 1","Zone 2","NSW","VIC". DO NOT bucket B0/N0/etc. into "Metro" or "Regional" — preserve the original code verbatim.
      "monthly_shipments": number | null,
      "avg_charge_aud": number | null,   // average per-parcel charge in AUD
      "avg_weight_kg": number | null,    // average parcel weight in kg if available
      "notes": string | null
    }
  ],
  "period_label": string | null,         // e.g. "Mar 2026", "Q1 2026", "FY26 avg" — derived from filename or cells
  "warnings": [string],                  // ambiguities, e.g. "fuel surcharge included in charge", "carrier name unclear"
  "missing_fields": [string]             // canonical fields you couldn't find: "monthly_shipments" | "avg_charge_aud" | "zone" | "service" | "carrier" | "avg_weight_kg" | "period_label"
}

Rules:
- One row per (carrier × service × zone) combination. Aggregate the source if it's per-shipment line items.
- ZONE PRESERVATION: copy the source zone code character-for-character. If the file has a column called "Zone" with values like "B0", "N1", "Z40", "n0", "b3" — keep them as-is (preserve case if shown). NEVER translate AusPost/StarTrack/Aramex zone codes into generic "Metro"/"Regional" buckets. Only use "Metro"/"Regional"/"Country" if THE FILE ITSELF uses those words. If a row has no zone column, leave zone as "Unknown" and add to missing_fields.
- Strip currency symbols and commas. Convert all charges to AUD numeric values.
- If avg_charge_aud isn't directly stated, compute it as (total_spend / monthly_shipments). Note this in warnings.
- Map service-level synonyms to the canonical set: "Express", "Standard", "Next Day", "Same Day", "International Express", "International Standard". Use exact strings — keep the original in notes if unsure.
- If a row has zero shipments, skip it.
- Never invent rows. If the document has no usable data, return rows: [] and explain in warnings.
- "missing_fields" is a hint to the user about what data is needed to complete a freight analysis. Be honest — list every canonical field you couldn't populate confidently.`;

const USER_PROMPT = `Extract the monthly shipment volume and average charge data from this file. Return JSON only — no markdown, no prose.`;

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantId = url.searchParams.get("tenant_id");
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_BYTES / 1024 / 1024}MB)` },
        { status: 413 }
      );
    }

    const mediaType = resolveMediaType(file);
    if (!mediaType) {
      return NextResponse.json(
        {
          error:
            "Unsupported file type. Use Excel, CSV, PDF or image (PNG/JPEG/WEBP/GIF).",
        },
        { status: 415 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();

    const anthropic = getAnthropic();

    let parsed: ParsedExtract;
    if (mediaType.kind === "text") {
      // Spreadsheet/CSV files MUST go through the deterministic
      // postcode-aware aggregator (mirrors ECX's postcode-first model).
      // We do NOT fall back to Claude for structured files — Claude
      // hallucinated postcodes-as-zones, garbage service names, etc.
      // If the file lacks a postcode column we return a clear error so
      // the user can use the canonical template instead.
      const fullText = await fileToText(arrayBuffer, mediaType.subtype);
      const shipmentLevel = await tryShipmentLevelAggregation(
        fullText,
        file.name
      );
      if (!shipmentLevel) {
        return NextResponse.json(
          {
            error:
              "Couldn't find a postcode + charge column in this spreadsheet. " +
              "Either upload a per-shipment export with a postcode column " +
              "(DESTPCODE, TO POSTAL CODE, Postcode, etc.) and a charge column " +
              "(Freight Amt, Amount, Charge), or download the canonical CSV " +
              "template and pre-aggregate by zone yourself.",
          },
          { status: 422 }
        );
      }
      parsed = shipmentLevel;
    } else {
      // PDFs / images / scanned invoices — Claude is the only viable parser.
      const message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 6000,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              buildFileBlock(
                mediaType.kind,
                mediaType.media,
                Buffer.from(arrayBuffer).toString("base64")
              ),
              { type: "text" as const, text: USER_PROMPT },
            ],
          },
        ],
      });
      const textBlock = message.content.find((b) => b.type === "text");
      const raw = textBlock && "text" in textBlock ? textBlock.text : "";
      parsed = parseExtractResponse(raw);
    }

    let persisted: PersistResult | null = null;
    if (parsed.lines && parsed.lines.length > 0 && tenantId) {
      try {
        persisted = await persistLines({
          tenantId,
          carrierCode: parsed.carrier_code,
          fileName: file.name,
          fileFormat: mediaType.kind === "text" ? mediaType.subtype : "pdf",
          lines: parsed.lines,
        });
      } catch (persistErr) {
        // Don't fail the whole extract if line persistence fails — the
        // user still gets the preview. Surface the error in warnings so
        // they can act on it.
        const m = persistErr instanceof Error ? persistErr.message : String(persistErr);
        parsed.warnings.push(
          `Line-level storage failed: ${m}. The aggregated preview is still usable but drill-down analysis won't be available for this upload.`
        );
      }
    } else if (parsed.lines && parsed.lines.length > 0 && !tenantId) {
      parsed.warnings.push(
        "No tenant_id provided — skipped persisting line-level data. Aggregated preview only."
      );
    }

    return NextResponse.json(buildResponse(parsed, file, mediaType, persisted));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface PersistArgs {
  tenantId: string;
  carrierCode: string | null;
  fileName: string;
  fileFormat: "csv" | "xlsx" | "pdf";
  lines: ShipmentLine[];
}

async function persistLines(args: PersistArgs): Promise<PersistResult | null> {
  const supabase = getSupabaseAdmin();

  let carrierId: string | null = null;
  if (args.carrierCode) {
    const { data: c, error: ce } = await supabase
      .from("carriers")
      .select("id")
      .eq("code", args.carrierCode)
      .maybeSingle();
    if (ce) throw new Error(`Carrier lookup failed: ${ce.message}`);
    carrierId = c?.id ?? null;
  }

  const { data: upload, error: ue } = await supabase
    .from("freight_uploads")
    .insert({
      tenant_id: args.tenantId,
      carrier_id: carrierId,
      upload_kind: "billing",
      file_format: args.fileFormat,
      file_name: args.fileName,
      status: "review",
    })
    .select("id")
    .single();
  if (ue || !upload) {
    throw new Error(`freight_uploads insert failed: ${ue?.message ?? "no row returned"}`);
  }

  // We need a carrier_id on every line (NOT NULL FK). If we couldn't
  // infer the carrier, skip line persistence and let the upload row
  // sit in review — the user can correct the carrier in the UI.
  if (!carrierId) {
    return {
      upload_id: upload.id,
      carrier_id: null,
      carrier_code: args.carrierCode ?? "",
      lines_written: 0,
    };
  }

  const canonicalLookup = await resolveCanonicalTiers({
    carrierId,
    tenantId: args.tenantId,
    rawLabels: args.lines.map((l) => l.service),
  });

  const lineRows = args.lines.map((l) => ({
    tenant_id: args.tenantId,
    upload_id: upload.id,
    carrier_id: carrierId,
    service_level: l.service,
    canonical_tier: lookupCanonicalTier(canonicalLookup, l.service),
    postcode: l.postcode,
    resolved_zone: l.resolved_zone,
    charge_aud: l.charge_aud,
    weight_kg: l.weight_kg,
    ship_date: l.ship_date,
    consignment: l.consignment,
    raw: l.raw,
  }));

  // Chunk inserts to stay under PostgREST payload limits.
  const chunkSize = 1000;
  let written = 0;
  for (let i = 0; i < lineRows.length; i += chunkSize) {
    const chunk = lineRows.slice(i, i + chunkSize);
    const { error: le } = await supabase.from("shipment_lines").insert(chunk);
    if (le) {
      throw new Error(
        `shipment_lines insert failed at chunk ${i / chunkSize + 1}: ${le.message}`
      );
    }
    written += chunk.length;
  }

  return {
    upload_id: upload.id,
    carrier_id: carrierId,
    carrier_code: args.carrierCode ?? "",
    lines_written: written,
  };
}

type ImageMedia = "image/png" | "image/jpeg" | "image/webp" | "image/gif";
type TextSubtype = "csv" | "xlsx";

type ResolvedMedia =
  | { kind: "document"; media: "application/pdf" }
  | { kind: "image"; media: ImageMedia }
  | { kind: "text"; subtype: TextSubtype };

function buildResponse(
  parsed: ParsedExtract,
  file: File,
  mediaType: ResolvedMedia,
  persisted: PersistResult | null
): ExtractResponse {
  return {
    rows: parsed.rows,
    period_label: parsed.period_label,
    warnings: parsed.warnings,
    missing_fields: parsed.missing_fields,
    persisted,
    meta: {
      model: MODEL,
      file_name: file.name,
      file_size: file.size,
      file_type:
        file.type ||
        (mediaType.kind === "text"
          ? `text/${mediaType.subtype}`
          : mediaType.media),
    },
  };
}

const CARRIER_LABEL_BY_CODE: Record<string, string> = {
  AUSPOST: "Australia Post",
  STARTRACK: "StarTrack",
  ARAMEX: "Aramex",
  TGE: "TGE",
  SENDLE: "Sendle",
  DHL_EXPRESS: "DHL Express",
  DHL_ECOM: "DHL eCommerce",
  COURIERS_PLEASE: "Couriers Please",
};

/**
 * If the file looks like a per-shipment billing export (postcode + service
 * + per-row charge), aggregate locally and resolve postcode → carrier-zone
 * via postcode_zones. Returns null if the columns don't match — the caller
 * falls back to the Claude path.
 */
async function tryShipmentLevelAggregation(
  text: string,
  filename: string
): Promise<ParsedExtract | null> {
  const { headers, rows } = parseRows(text);
  if (headers.length === 0 || rows.length === 0) return null;
  const cols = detectShipmentColumns(headers);
  if (!cols) return null;

  const services = cols.service
    ? Array.from(
        new Set(
          rows
            .map((r) => (r[cols.service as string] ?? "").trim())
            .filter((s) => s.length > 0)
        )
      )
    : [];
  const carrierCode = inferCarrierCode(filename, services);
  const carrierLabel =
    CARRIER_LABEL_BY_CODE[carrierCode] ?? carrierCode ?? "Unknown carrier";

  const zoneCol = getZoneColumn();
  const postcodeZoneLookup: PostcodeZoneMap = new Map();
  const uniquePostcodes = new Set<string>();
  for (const row of rows) {
    const pc = String(row[cols.postcode] ?? "")
      .replace(/[^\d]/g, "")
      .padStart(4, "0");
    if (pc.length === 4) uniquePostcodes.add(pc);
  }
  if (uniquePostcodes.size > 0) {
    const supabase = getSupabaseAdmin();
    const list = Array.from(uniquePostcodes);
    // Supabase IN-list is bounded; chunk by 500 to be safe.
    const chunkSize = 500;
    for (let i = 0; i < list.length; i += chunkSize) {
      const chunk = list.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from("postcode_zones")
        .select(`postcode, ${zoneCol}`)
        .in("postcode", chunk);
      if (error) {
        throw new Error(
          `postcode_zones lookup failed: ${error.message}. Confirm the table is populated.`
        );
      }
      for (const r of data ?? []) {
        const row = r as Record<string, string | null>;
        const pc = row.postcode;
        const zone = row[zoneCol];
        if (pc && zone) postcodeZoneLookup.set(pc, zone);
      }
    }
  }

  const result = aggregateShipments(
    rows,
    cols,
    postcodeZoneLookup,
    carrierCode,
    carrierLabel
  );

  return {
    rows: result.rows.map((r) => ({
      carrier: r.carrier,
      service: r.service,
      zone: r.zone,
      monthly_shipments: r.monthly_shipments,
      avg_charge_aud: r.avg_charge_aud,
      avg_weight_kg: r.avg_weight_kg,
      notes: r.notes,
    })),
    period_label: null,
    warnings: result.warnings,
    missing_fields: result.missing_fields,
    lines: result.lines,
    carrier_code: result.carrier_code || null,
  };
}

function resolveMediaType(file: File): ResolvedMedia | null {
  const name = file.name.toLowerCase();
  const mime = file.type.toLowerCase();
  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    return { kind: "document", media: "application/pdf" };
  }
  if (mime === "image/png" || name.endsWith(".png")) {
    return { kind: "image", media: "image/png" };
  }
  if (mime === "image/jpeg" || mime === "image/jpg" || /\.jpe?g$/.test(name)) {
    return { kind: "image", media: "image/jpeg" };
  }
  if (mime === "image/webp" || name.endsWith(".webp")) {
    return { kind: "image", media: "image/webp" };
  }
  if (mime === "image/gif" || name.endsWith(".gif")) {
    return { kind: "image", media: "image/gif" };
  }
  if (
    mime.includes("spreadsheetml") ||
    mime === "application/vnd.ms-excel" ||
    name.endsWith(".xlsx") ||
    name.endsWith(".xls")
  ) {
    return { kind: "text", subtype: "xlsx" };
  }
  if (mime === "text/csv" || name.endsWith(".csv")) {
    return { kind: "text", subtype: "csv" };
  }
  return null;
}

async function fileToText(
  arrayBuffer: ArrayBuffer,
  subtype: TextSubtype
): Promise<string> {
  if (subtype === "csv") {
    return new TextDecoder("utf-8").decode(arrayBuffer).trim();
  }
  const XLSX = await import("xlsx");
  const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
  const blocks: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    blocks.push(`### Sheet: ${name}\n${csv.trim()}`);
  }
  return blocks.join("\n\n");
}

function buildFileBlock(
  kind: "document" | "image",
  mediaType: string,
  base64: string
) {
  if (kind === "document") {
    return {
      type: "document" as const,
      source: {
        type: "base64" as const,
        media_type: "application/pdf" as const,
        data: base64,
      },
    };
  }
  return {
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: mediaType as ImageMedia,
      data: base64,
    },
  };
}

const KNOWN_MISSING_FIELDS: ReadonlySet<string> = new Set([
  "carrier",
  "service",
  "zone",
  "monthly_shipments",
  "avg_charge_aud",
  "avg_weight_kg",
  "period_label",
]);

interface ParsedExtract {
  rows: ExtractedRow[];
  period_label: string | null;
  warnings: string[];
  missing_fields: string[];
  // Only set when the deterministic spreadsheet path produced lines.
  // PDF/image responses go through Claude and have no per-line data.
  lines: ShipmentLine[] | null;
  carrier_code: string | null;
}

function parseExtractResponse(raw: string): ParsedExtract {
  if (!raw) {
    return {
      rows: [],
      period_label: null,
      warnings: ["Empty response from extractor"],
      missing_fields: [],
      lines: null,
      carrier_code: null,
    };
  }

  const jsonText = stripJsonFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return {
      rows: [],
      period_label: null,
      warnings: [`Extractor returned non-JSON output: ${raw.slice(0, 200)}…`],
      missing_fields: [],
      lines: null,
      carrier_code: null,
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      rows: [],
      period_label: null,
      warnings: ["Extractor returned non-object payload"],
      missing_fields: [],
      lines: null,
      carrier_code: null,
    };
  }
  const obj = parsed as {
    rows?: unknown;
    warnings?: unknown;
    period_label?: unknown;
    missing_fields?: unknown;
  };

  const rowsIn = Array.isArray(obj.rows) ? obj.rows : [];
  const warningsIn = Array.isArray(obj.warnings) ? obj.warnings : [];
  const missingIn = Array.isArray(obj.missing_fields) ? obj.missing_fields : [];

  const warnings = warningsIn
    .filter((w): w is string => typeof w === "string" && w.trim().length > 0)
    .map((w) => w.trim());

  const missingFields = missingIn
    .filter((m): m is string => typeof m === "string")
    .map((m) => m.trim().toLowerCase())
    .filter((m) => KNOWN_MISSING_FIELDS.has(m));

  const rows: ExtractedRow[] = [];
  for (const item of rowsIn) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const carrier = toNullableString(r.carrier);
    const service = toNullableString(r.service);
    const zone = toNullableString(r.zone);
    if (!carrier && !service && !zone) continue;

    rows.push({
      carrier: carrier ?? "",
      service: service ?? "",
      zone: zone ?? "",
      monthly_shipments: toFiniteNumber(r.monthly_shipments),
      avg_charge_aud: toFiniteNumber(r.avg_charge_aud),
      avg_weight_kg: toFiniteNumber(r.avg_weight_kg),
      notes: toNullableString(r.notes),
    });
  }

  return {
    rows,
    period_label: toNullableString(obj.period_label),
    warnings,
    missing_fields: missingFields,
    lines: null,
    carrier_code: null,
  };
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  if (fence) return fence[1].trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function toFiniteNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toNullableString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

