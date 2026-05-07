import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAnthropic } from "@/lib/analyzer/anthropic";
import {
  replaceRateCardLines,
  type RateCardLineInput,
} from "@/lib/actions/rate-cards";
import type {
  FreightRateCard,
  FreightRateCardLine,
  RateBasis,
} from "@/lib/db/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL = "claude-sonnet-4-5";
const MAX_INSTRUCTION_LEN = 2000;

const VALID_BASIS: ReadonlySet<RateBasis> = new Set<RateBasis>([
  "per_parcel",
  "per_kg",
  "per_parcel_plus_per_kg",
]);

interface RouteContext {
  params: { id: string };
}

interface TransformBody {
  instruction: string;
}

const SYSTEM_PROMPT = `You apply consultant instructions to a freight rate-card and return the rewritten line items.

The user supplies the rate-card metadata, the current line items, and a free-text instruction (e.g. "rate card should be exclusive of GST", "round all rates to nearest 5 cents", "add 8% to Metro NSW rates only").

Return STRICT JSON only — no prose, no markdown fences:

{
  "lines": [
    {
      "zone_label": string,
      "zone_description": string | null,
      "weight_min_kg": number | null,
      "weight_max_kg": number | null,
      "rate_basis": "per_parcel" | "per_kg" | "per_parcel_plus_per_kg",
      "rate_aud": number,
      "per_kg_rate_aud": number | null,
      "minimum_charge_aud": number | null,
      "notes": string | null
    }
  ],
  "summary": string,                 // one short sentence: what changed and why (e.g. "Divided all rates by 1.10 to strip 10% GST")
  "warnings": [string]               // anything ambiguous, skipped, or that needed assumption
}

Rules:
- Preserve every existing line unless the instruction explicitly removes it. Do not invent new rows.
- Operate row-by-row. If a row's notes already say "GST exclusive" and the instruction is "make it GST exclusive", leave that row's rate untouched and warn.
- For Australian GST: GST-inclusive → exclusive = divide by 1.10. GST-exclusive → inclusive = multiply by 1.10.
- Round monetary fields to 4 decimal places maximum; cents-aware where it matters.
- Update the row's notes field to reflect the change (e.g. replace "GST inclusive" with "GST exclusive"), but keep it terse.
- If the instruction is ambiguous or you can't apply it confidently, return the lines UNCHANGED and explain in warnings.
- Never drop a row to "fix" something — flag it instead.`;

interface CardSummary {
  id: string;
  carrier: string;
  service_level: string;
  status: string;
  fuel_surcharge_percent: number | null;
}

interface RawLine {
  zone_label: string;
  zone_description: string | null;
  weight_min_kg: number | null;
  weight_max_kg: number | null;
  rate_basis: string;
  rate_aud: number;
  per_kg_rate_aud: number | null;
  minimum_charge_aud: number | null;
  notes: string | null;
}

interface CardWithCarrier extends FreightRateCard {
  carrier: { id: string; name: string; code: string };
  lines: FreightRateCardLine[];
}

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const body = (await req.json()) as TransformBody;
    const instruction = (body.instruction ?? "").trim();
    if (!instruction) {
      return NextResponse.json({ error: "Instruction is required" }, { status: 400 });
    }
    if (instruction.length > MAX_INSTRUCTION_LEN) {
      return NextResponse.json(
        { error: `Instruction too long (max ${MAX_INSTRUCTION_LEN} chars)` },
        { status: 400 }
      );
    }

    const card = await loadCard(params.id);
    if (!card) {
      return NextResponse.json({ error: "Rate card not found" }, { status: 404 });
    }
    if (card.lines.length === 0) {
      return NextResponse.json(
        { error: "Rate card has no lines to transform" },
        { status: 400 }
      );
    }

    const summary: CardSummary = {
      id: card.id,
      carrier: card.carrier.name,
      service_level: card.service_level,
      status: card.status,
      fuel_surcharge_percent: card.fuel_surcharge_percent,
    };

    const linesForPrompt: RawLine[] = card.lines.map((l) => ({
      zone_label: l.zone_label,
      zone_description: l.zone_description,
      weight_min_kg: l.weight_min_kg,
      weight_max_kg: l.weight_max_kg,
      rate_basis: l.rate_basis,
      rate_aud: l.rate_aud,
      per_kg_rate_aud: l.per_kg_rate_aud,
      minimum_charge_aud: l.minimum_charge_aud,
      notes: l.notes,
    }));

    const userPrompt = [
      `Rate card metadata:\n${JSON.stringify(summary, null, 2)}`,
      ``,
      `Current lines (${card.lines.length}):`,
      JSON.stringify(linesForPrompt, null, 2),
      ``,
      `Instruction:\n${instruction}`,
      ``,
      `Apply the instruction and return JSON only.`,
    ].join("\n");

    const anthropic = getAnthropic();
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const raw = textBlock && "text" in textBlock ? textBlock.text : "";
    const parsed = parseTransformResponse(raw, card.lines.length);

    if (parsed.lines.length === 0) {
      return NextResponse.json(
        {
          error:
            "Transform returned no usable lines. " +
            (parsed.warnings[0] ?? "Try a more specific instruction."),
          warnings: parsed.warnings,
        },
        { status: 422 }
      );
    }

    const inserted = await replaceRateCardLines(card.id, parsed.lines);

    return NextResponse.json({
      summary: parsed.summary,
      warnings: parsed.warnings,
      lines_applied: inserted.length,
      lines_before: card.lines.length,
      model: MODEL,
    });
  } catch (e: unknown) {
    const messageText = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: messageText }, { status: 500 });
  }
}

async function loadCard(id: string): Promise<CardWithCarrier | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("freight_rate_cards")
    .select("*, carrier:carriers!inner(id, name, code), lines:freight_rate_card_lines(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`loadCard: ${error.message}`);
  return (data as CardWithCarrier | null) ?? null;
}

function parseTransformResponse(
  raw: string,
  expectedLineCount: number
): {
  lines: RateCardLineInput[];
  summary: string;
  warnings: string[];
} {
  if (!raw) {
    return { lines: [], summary: "", warnings: ["Empty response from model"] };
  }

  const jsonText = stripJsonFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return {
      lines: [],
      summary: "",
      warnings: [`Model returned non-JSON output: ${raw.slice(0, 200)}…`],
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return { lines: [], summary: "", warnings: ["Model returned non-object payload"] };
  }
  const obj = parsed as { lines?: unknown; summary?: unknown; warnings?: unknown };

  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  const warningsIn = Array.isArray(obj.warnings) ? obj.warnings : [];
  const cleanWarnings = warningsIn
    .filter((w): w is string => typeof w === "string" && w.trim().length > 0)
    .map((w) => w.trim());

  const linesIn = Array.isArray(obj.lines) ? obj.lines : [];
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

  if (cleanLines.length > 0 && cleanLines.length < expectedLineCount * 0.5) {
    cleanWarnings.unshift(
      `Returned only ${cleanLines.length} lines; original had ${expectedLineCount}. ` +
        `Review carefully — the instruction may have unintentionally dropped rows.`
    );
  }

  return { lines: cleanLines, summary, warnings: cleanWarnings };
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
