import { NextResponse } from "next/server";
import { getAnthropic } from "@/lib/analyzer/anthropic";
import type { RateCardLineInput } from "@/lib/actions/rate-cards";
import type { RateBasis } from "@/lib/db/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 15 * 1024 * 1024;
const MODEL = "claude-sonnet-4-5";

const VALID_BASIS: ReadonlySet<RateBasis> = new Set<RateBasis>([
  "per_parcel",
  "per_kg",
  "per_parcel_plus_per_kg",
]);

interface ExtractResponse {
  lines: RateCardLineInput[];
  warnings: string[];
  meta: {
    model: string;
    file_name: string;
    file_size: number;
    file_type: string;
  };
}

const SYSTEM_PROMPT = `You extract freight rate-card line items from carrier-supplied documents (PDF, images, or scanned tables).

Return STRICT JSON only — no prose, no markdown fences.

Output shape:
{
  "lines": [
    {
      "zone_label": string,                       // e.g. "Metro NSW", "Zone 1", postcode range
      "zone_description": string | null,          // human-readable zone, e.g. "Sydney metro"
      "weight_min_kg": number | null,             // inclusive lower bound
      "weight_max_kg": number | null,             // inclusive upper bound
      "rate_basis": "per_parcel" | "per_kg" | "per_parcel_plus_per_kg",
      "rate_aud": number,                          // base parcel rate in AUD
      "per_kg_rate_aud": number | null,            // additional per-kg charge if rate_basis = per_parcel_plus_per_kg
      "minimum_charge_aud": number | null,         // floor charge if specified
      "notes": string | null                       // any caveats from the source row
    }
  ],
  "warnings": [string]                             // any ambiguities you flagged (e.g. "fuel surcharge not included", "GST status unclear")
}

Rules:
- One row per (zone × weight bracket) combination. If the source has a matrix (zones across, weights down), expand to rows.
- Strip currency symbols and commas. Convert all rates to AUD numeric values.
- If the source uses tiered rates (per parcel + per kg), use rate_basis = "per_parcel_plus_per_kg" and split the components.
- If a row is purely metadata (carrier name, effective date, fuel %), skip it — surface in warnings if useful.
- If you can't determine a value confidently, use null rather than guessing.
- Never invent rows. If the document has no rate table, return lines: [] and explain in warnings.`;

const USER_PROMPT = `Extract every rate line from this rate card. Return JSON only — no markdown, no prose.`;

export async function POST(req: Request) {
  try {
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
            "Unsupported file type. Use Excel, PDF or image (PNG/JPEG/WEBP/GIF).",
        },
        { status: 415 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();

    const anthropic = getAnthropic();
    const userContent =
      mediaType.kind === "spreadsheet"
        ? [
            {
              type: "text" as const,
              text: `${USER_PROMPT}\n\nFile name: ${file.name}\n\n${await spreadsheetToText(arrayBuffer)}`,
            },
          ]
        : [
            buildFileBlock(
              mediaType.kind,
              mediaType.media,
              Buffer.from(arrayBuffer).toString("base64")
            ),
            { type: "text" as const, text: USER_PROMPT },
          ];

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: userContent,
        },
      ],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const raw = textBlock && "text" in textBlock ? textBlock.text : "";
    const parsed = parseExtractResponse(raw);

    const response: ExtractResponse = {
      lines: parsed.lines,
      warnings: parsed.warnings,
      meta: {
        model: MODEL,
        file_name: file.name,
        file_size: file.size,
        file_type: file.type || mediaType.media,
      },
    };
    return NextResponse.json(response);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type FileKind = "document" | "image" | "spreadsheet";
type DocumentMedia = "application/pdf";
type ImageMedia = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

function resolveMediaType(
  file: File
):
  | { kind: "document"; media: DocumentMedia }
  | { kind: "image"; media: ImageMedia }
  | { kind: "spreadsheet"; media: "spreadsheet" }
  | null {
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
    return { kind: "spreadsheet", media: "spreadsheet" };
  }
  return null;
}

async function spreadsheetToText(arrayBuffer: ArrayBuffer): Promise<string> {
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

function buildFileBlock(kind: FileKind, mediaType: string, base64: string) {
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

function parseExtractResponse(raw: string): {
  lines: RateCardLineInput[];
  warnings: string[];
} {
  if (!raw) return { lines: [], warnings: ["Empty response from extractor"] };

  const jsonText = stripJsonFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return {
      lines: [],
      warnings: [`Extractor returned non-JSON output: ${raw.slice(0, 200)}…`],
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return { lines: [], warnings: ["Extractor returned non-object payload"] };
  }
  const obj = parsed as { lines?: unknown; warnings?: unknown };
  const linesIn = Array.isArray(obj.lines) ? obj.lines : [];
  const warningsIn = Array.isArray(obj.warnings) ? obj.warnings : [];

  const cleanWarnings = warningsIn
    .filter((w): w is string => typeof w === "string" && w.trim().length > 0)
    .map((w) => w.trim());

  const cleanLines: RateCardLineInput[] = [];
  for (const item of linesIn) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;

    const zoneLabel = typeof r.zone_label === "string" ? r.zone_label.trim() : "";
    if (!zoneLabel) continue;

    const rate = toFiniteNumber(r.rate_aud);
    if (rate == null) continue;

    const basisRaw = typeof r.rate_basis === "string" ? r.rate_basis : "per_parcel";
    const basis: RateBasis = VALID_BASIS.has(basisRaw as RateBasis)
      ? (basisRaw as RateBasis)
      : "per_parcel";

    cleanLines.push({
      zone_label: zoneLabel,
      zone_description: toNullableString(r.zone_description),
      weight_min_kg: toFiniteNumber(r.weight_min_kg),
      weight_max_kg: toFiniteNumber(r.weight_max_kg),
      rate_basis: basis,
      rate_aud: rate,
      per_kg_rate_aud: toFiniteNumber(r.per_kg_rate_aud),
      minimum_charge_aud: toFiniteNumber(r.minimum_charge_aud),
      notes: toNullableString(r.notes),
    });
  }

  return { lines: cleanLines, warnings: cleanWarnings };
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
