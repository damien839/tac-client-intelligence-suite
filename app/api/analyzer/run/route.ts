import { NextResponse } from "next/server";
import { loadAnalyzerSkill } from "@/lib/analyzer/skill-loader";
import { buildAnalyzerSnapshot } from "@/lib/analyzer/snapshot";
import { getAnthropic } from "@/lib/analyzer/anthropic";
import { validateReport } from "@/lib/analyzer/validate-report";
import { saveAnalysis } from "@/lib/actions/freight-analyses";

export const runtime = "nodejs";
export const maxDuration = 300;

interface RunRequestBody {
  tenant_id: string;
  notes?: string;
}

export async function POST(req: Request) {
  const started = Date.now();
  try {
    const body = (await req.json()) as RunRequestBody;
    if (!body.tenant_id) {
      return NextResponse.json({ error: "tenant_id is required" }, { status: 400 });
    }

    const [skill, snapshot] = await Promise.all([
      loadAnalyzerSkill(),
      buildAnalyzerSnapshot(body.tenant_id),
    ]);

    if (snapshot.volumes.length === 0) {
      return NextResponse.json(
        {
          error:
            "No shipment volumes captured for this tenant. Add a Current Volume CSV before running an analysis.",
        },
        { status: 400 }
      );
    }
    if (snapshot.current_rate_cards.length === 0 && snapshot.new_rate_cards.length === 0) {
      return NextResponse.json(
        {
          error:
            "No rate cards loaded for this tenant. Add at least one current or new rate card.",
        },
        { status: 400 }
      );
    }

    const systemPrompt = buildReportSystemPrompt(skill);
    const userPrompt = buildReportUserPrompt(snapshot);

    const anthropic = getAnthropic();
    const result = await runWithRetry({
      anthropic,
      model: skill.frontmatter.runtime.report_model,
      maxTokens: skill.frontmatter.runtime.max_tokens_report,
      temperature: skill.frontmatter.runtime.temperature_report,
      system: systemPrompt,
      userPrompt,
      schema: skill.reportSchema,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: "Analyzer returned a payload that failed schema validation",
          details: result.errorSummary,
          raw: result.rawText,
        },
        { status: 502 }
      );
    }

    const durationMs = Date.now() - started;

    const saved = await saveAnalysis({
      tenant_id: body.tenant_id,
      snapshot_json: snapshot,
      report_json: result.payload,
      schema_version:
        typeof (result.payload as { schema_version?: unknown }).schema_version === "string"
          ? ((result.payload as { schema_version: string }).schema_version)
          : "0.1.0",
      model: skill.frontmatter.runtime.report_model,
      tokens_input: result.usage?.input_tokens ?? undefined,
      tokens_output: result.usage?.output_tokens ?? undefined,
      duration_ms: durationMs,
      notes: body.notes,
    });

    return NextResponse.json({
      id: saved.id,
      report_json: saved.report_json,
      duration_ms: durationMs,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface RunArgs {
  anthropic: ReturnType<typeof getAnthropic>;
  model: string;
  maxTokens: number;
  temperature: number;
  system: string;
  userPrompt: string;
  schema: Record<string, unknown>;
}

interface RunResult {
  ok: boolean;
  payload: unknown;
  rawText: string;
  errorSummary: string | null;
  usage: { input_tokens: number; output_tokens: number } | null;
}

async function runWithRetry(args: RunArgs): Promise<RunResult> {
  const first = await callOnce(args);
  if (first.ok) return first;

  // One retry — feed the validation errors back so the model can fix the payload
  const retryPrompt = [
    args.userPrompt,
    "",
    "Your previous response failed schema validation with the following errors:",
    first.errorSummary ?? "(no details)",
    "",
    "Return the corrected JSON only. No prose, no code fences, no commentary.",
  ].join("\n");

  const second = await callOnce({ ...args, userPrompt: retryPrompt });
  return second;
}

async function callOnce(args: RunArgs): Promise<RunResult> {
  const resp = await args.anthropic.messages.create({
    model: args.model,
    max_tokens: args.maxTokens,
    temperature: args.temperature,
    system: args.system,
    messages: [{ role: "user", content: args.userPrompt }],
  });

  const text = extractText(resp.content);
  const parsed = tryParseJson(text);

  if (!parsed.ok) {
    return {
      ok: false,
      payload: null,
      rawText: text,
      errorSummary: `JSON parse failed: ${parsed.error}`,
      usage: { input_tokens: resp.usage.input_tokens, output_tokens: resp.usage.output_tokens },
    };
  }

  // We pull schema from skill loader at the call site
  const validation = validateReport(args.schema, parsed.value);
  return {
    ok: validation.ok,
    payload: parsed.value,
    rawText: text,
    errorSummary: validation.errorSummary,
    usage: { input_tokens: resp.usage.input_tokens, output_tokens: resp.usage.output_tokens },
  };
}

function extractText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

function tryParseJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const stripped = stripCodeFences(raw).trim();
  try {
    return { ok: true, value: JSON.parse(stripped) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

function stripCodeFences(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fenced ? fenced[1] : raw;
}

function buildReportSystemPrompt(skill: Awaited<ReturnType<typeof loadAnalyzerSkill>>) {
  return [
    skill.reportPrompt,
    "",
    "## Reference material",
    "",
    skill.referencesBundle,
    "",
    "## Output schema (authoritative)",
    "",
    "```json",
    JSON.stringify(skill.reportSchema, null, 2),
    "```",
  ].join("\n");
}

function buildReportUserPrompt(
  snapshot: Awaited<ReturnType<typeof buildAnalyzerSnapshot>>
): string {
  return [
    "Generate the report payload for this tenant snapshot.",
    "",
    "Output rules:",
    "- Return valid JSON only — no prose, no code fences, no commentary.",
    "- The JSON MUST validate against the schema in the system prompt.",
    "- All numeric fields must be numbers (not strings).",
    "- Compute every value yourself from the snapshot — do not invent figures.",
    "",
    "<snapshot>",
    JSON.stringify(snapshot),
    "</snapshot>",
  ].join("\n");
}
