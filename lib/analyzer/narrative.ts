import "server-only";

import { getAnthropic } from "./anthropic";
import type { AnalyzerSkill } from "./skill-loader";
import type {
  AnalyzerReport,
  DeterministicReport,
  ReviewFinding,
} from "./report-types";

/**
 * Narrative pass. Claude writes ONLY the prose strings — every numeric value
 * is locked in by the deterministic engine. We feed the deterministic report
 * in as JSON and ask for a structured response containing only:
 *   - header.confidence_note
 *   - headline_savings.framing
 *   - top_opportunities[*].consultant_note
 *   - recommendations[*].rationale
 *
 * If the response is malformed we keep the engine's placeholder strings — the
 * report still renders, it just reads more clinically.
 */

export interface NarrativeUsage {
  input_tokens: number;
  output_tokens: number;
  model: string;
}

export interface NarrativeResult {
  report: DeterministicReport;
  usage: NarrativeUsage | null;
  raw_text: string;
  ok: boolean;
  error_summary: string | null;
}

interface NarrativeResponse {
  analyst_summary?: string;
  confidence_note?: string;
  framing?: string;
  top_opportunities?: Array<{ rank: number; consultant_note: string }>;
  recommendations?: Array<{ index: number; rationale: string }>;
}

export async function applyNarrative(
  report: DeterministicReport,
  skill: AnalyzerSkill,
  options: { revisionFeedback?: ReviewFinding[] } = {}
): Promise<NarrativeResult> {
  const anthropic = getAnthropic();
  const model = skill.frontmatter.runtime.report_model;

  const system = buildNarrativeSystemPrompt(skill);
  const user = buildNarrativeUserPrompt(report, options.revisionFeedback);

  const resp = await anthropic.messages.create({
    model,
    max_tokens: 4000,
    temperature: 0.2,
    system,
    messages: [{ role: "user", content: user }],
  });

  const text = extractText(resp.content);
  const parsed = tryParseJson(text);
  if (!parsed.ok) {
    return {
      report,
      usage: { input_tokens: resp.usage.input_tokens, output_tokens: resp.usage.output_tokens, model },
      raw_text: text,
      ok: false,
      error_summary: `narrative: ${parsed.error}`,
    };
  }

  const merged = mergeNarrative(report, parsed.value as NarrativeResponse);
  return {
    report: merged,
    usage: { input_tokens: resp.usage.input_tokens, output_tokens: resp.usage.output_tokens, model },
    raw_text: text,
    ok: true,
    error_summary: null,
  };
}

function buildNarrativeSystemPrompt(skill: AnalyzerSkill): string {
  return [
    "You are TAC's Final Mile Analyzer narrative writer. The numbers in the report are locked — they came from a deterministic engine, NOT from you. You only write the prose strings.",
    "",
    "Your job: write tight, decision-framed prose. No fluff. No hype. No invented figures.",
    "",
    "Voice rules:",
    "- Operator-first, anti-fluff. One declarative sentence per field unless explicitly more is allowed.",
    "- Cite the specific number when relevant. Round to whole dollars in prose.",
    "- Never invent statistics, never speculate on lanes that aren't in the report, never claim service degradation is acceptable.",
    "- 'analyst_summary' is 2-5 sentences. State (a) what carriers/stack you compared against what, (b) the period and volume in scope, (c) the method (e.g. weighted CPO, lognormal weight distribution, fuel mode), and (d) any notable exclusion or caveat from the context_confirmation. Read like a senior analyst opening a deck — no fluff, no headline numbers, no recommendations.",
    "- 'consultant_note' must reference the lane's mechanic (e.g. zone, weight bucket, current carrier vs replacement).",
    "- 'rationale' explains why this recommendation matters, not what it is.",
    "- 'framing' is one sentence that frames the headline savings as a decision the tenant should make this quarter.",
    "- 'confidence_note' explains in plain English what the confidence score means and what would lift it.",
    "",
    "## Skill body (context)",
    "",
    skill.skillBody,
  ].join("\n");
}

function buildNarrativeUserPrompt(
  report: DeterministicReport,
  revisionFeedback?: ReviewFinding[]
): string {
  const parts = [
    "Below is the deterministic report payload. Write the narrative strings ONLY.",
    "",
    "Return JSON with this exact shape — no prose, no code fences:",
    "```",
    "{",
    '  "analyst_summary": "string (2-5 sentences)",',
    '  "confidence_note": "string",',
    '  "framing": "string",',
    '  "top_opportunities": [{"rank": 1, "consultant_note": "string"}, ...],',
    '  "recommendations": [{"index": 0, "rationale": "string"}, ...]',
    "}",
    "```",
    "",
    "Rules:",
    "- One opportunity entry per rank present in the report.",
    "- One recommendation entry per index (0-based) present in the report.",
    "- Do NOT touch any numeric field — the engine owns them.",
    "",
    "<report>",
    JSON.stringify(report),
    "</report>",
  ];

  if (revisionFeedback && revisionFeedback.length > 0) {
    parts.push(
      "",
      "<critic_findings>",
      "The previous narrative draft was reviewed by a critic. Address these issues in the new draft:",
      ...revisionFeedback.map(
        (f) => `- [${f.severity}] ${f.claim}: ${f.issue}${f.fix ? ` → ${f.fix}` : ""}`
      ),
      "</critic_findings>"
    );
  }

  return parts.join("\n");
}

function mergeNarrative(
  report: DeterministicReport,
  resp: NarrativeResponse
): DeterministicReport {
  const next: DeterministicReport = {
    ...report,
    header: { ...report.header },
    headline_savings: { ...report.headline_savings },
    top_opportunities: report.top_opportunities.map((o) => ({ ...o })),
    recommendations: report.recommendations.map((r) => ({ ...r })),
  };

  if (typeof resp.analyst_summary === "string" && resp.analyst_summary.trim()) {
    next.analyst_summary = resp.analyst_summary.trim();
  }
  if (typeof resp.confidence_note === "string" && resp.confidence_note.trim()) {
    next.header.confidence_note = resp.confidence_note.trim();
  }
  if (typeof resp.framing === "string" && resp.framing.trim()) {
    next.headline_savings.framing = resp.framing.trim();
  }
  if (Array.isArray(resp.top_opportunities)) {
    for (const entry of resp.top_opportunities) {
      if (!entry || typeof entry !== "object") continue;
      const rank = Number(entry.rank);
      const note = typeof entry.consultant_note === "string" ? entry.consultant_note.trim() : "";
      if (!note) continue;
      const target = next.top_opportunities.find((o) => o.rank === rank);
      if (target) target.consultant_note = note;
    }
  }
  if (Array.isArray(resp.recommendations)) {
    for (const entry of resp.recommendations) {
      if (!entry || typeof entry !== "object") continue;
      const idx = Number(entry.index);
      const rationale = typeof entry.rationale === "string" ? entry.rationale.trim() : "";
      if (!rationale) continue;
      if (idx >= 0 && idx < next.recommendations.length) {
        next.recommendations[idx].rationale = rationale;
      }
    }
  }
  return next;
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

/** Type-only helper kept to avoid a dependency cycle if AnalyzerReport changes shape. */
export type _NarrativeReportShape = AnalyzerReport;
