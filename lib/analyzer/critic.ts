import "server-only";

import { getAnthropic } from "./anthropic";
import type { AnalyzerSkill } from "./skill-loader";
import type {
  CriticVerdict,
  DeterministicReport,
  ReviewCategory,
  ReviewFinding,
  ReviewResult,
} from "./report-types";
import type { SelfCheckFinding } from "./self-check";

const REVIEW_CATEGORIES: ReviewCategory[] = [
  "math",
  "methodology",
  "table_analysis",
  "recommendations",
  "narrative",
  "context",
  "customer_facing",
  "general",
];

/**
 * Adversarial critic. Reads the deterministic report + narrative + self-check
 * findings and tries to find anything wrong: numbers that don't reconcile,
 * narrative claims that overshoot the data, opportunities ranked out of
 * order, recommendations that contradict service-tier integrity, etc.
 *
 * The critic is intentionally hostile — its job is to fail the report unless
 * the math and the prose are both defensible.
 */

export interface CriticUsage {
  input_tokens: number;
  output_tokens: number;
  model: string;
}

export interface CriticOutcome {
  result: ReviewResult;
  usage: CriticUsage | null;
  raw_text: string;
}

export async function runCritic(
  report: DeterministicReport,
  skill: AnalyzerSkill,
  selfCheckFindings: SelfCheckFinding[],
  revisionCount: number
): Promise<CriticOutcome> {
  const anthropic = getAnthropic();
  const model = skill.frontmatter.runtime.report_model;

  const system = buildCriticSystemPrompt(skill);
  const user = buildCriticUserPrompt(report, selfCheckFindings);

  const resp = await anthropic.messages.create({
    model,
    max_tokens: 12000,
    temperature: 0,
    system,
    messages: [{ role: "user", content: user }],
  });

  const text = extractText(resp.content);
  const parsed = tryParseJson(text);

  const usage: CriticUsage = {
    input_tokens: resp.usage.input_tokens,
    output_tokens: resp.usage.output_tokens,
    model,
  };

  if (!parsed.ok) {
    // Fail loud — if the critic itself is malformed, do not silently accept.
    return {
      result: {
        verdict: "needs_revision",
        revision_count: revisionCount,
        findings: [
          {
            severity: "warn",
            claim: "Critic response could not be parsed as JSON.",
            issue: parsed.error,
            evidence: text.slice(0, 400),
            fix: null,
            linked_section: null,
            category: "general",
          },
        ],
        customer_facing_ready: false,
        readiness_summary:
          "Critic response could not be parsed — manual review required before sharing.",
        readiness_blockers: ["Critic JSON unparseable"],
        strengths: [],
      },
      usage,
      raw_text: text,
    };
  }

  const result = normaliseCriticResponse(parsed.value, revisionCount);
  return { result, usage, raw_text: text };
}

function buildCriticSystemPrompt(skill: AnalyzerSkill): string {
  return [
    "You are TAC's adversarial reviewer for the Final Mile Analyzer. Your job is to find problems and assess whether this report is ready to go in front of a paying client. Default stance: skeptical. Find things. A clean pass with zero findings is almost never correct — there are always nuances worth surfacing.",
    "",
    "Your output drives two things on the dashboard:",
    "1. A 'customer-facing readiness' verdict the consultant sees BEFORE sending the report.",
    "2. A categorised findings list the consultant uses to brief themselves before the client meeting.",
    "",
    "## Review dimensions (work through ALL of them)",
    "",
    "### 1. Math reconciliation (category: math)",
    "- Sum of spend_comparison.table rows must equal headline_savings numbers (within $1 rounding).",
    "- Annual = monthly × 12 throughout. Per-parcel × monthly_shipments × 12 = annual_savings per lane.",
    "- Conservation: current_monthly_spend - projected_monthly_spend == monthly_savings_aud per fuel view.",
    "- Fuel views internally consistent: more surcharges should not lower projected cost vs base.",
    "- Sensitivity bounds: low ≤ mid ≤ high, all using same units.",
    "- Top opportunities are actually the highest-saving lanes from the table, sorted descending.",
    "",
    "### 2. Spend comparison table walk (category: table_analysis)",
    "**This is the most important review surface.** Walk the spend_comparison.table row by row. For every material lane (≥3% of total monthly_shipments OR ≥5% of total annual_savings), check:",
    "- Current CPO plausibility: AU domestic small-parcel CPO is typically $5–$25. Anything <$3 or >$40 needs a flag with the row id and CPO. Industrial / heavy-freight lanes may legitimately go higher — note context if available.",
    "- Projected CPO plausibility: same range. If a replacement CPO is <50% of current, flag it — usually a rate-card unit error or service-tier mismatch.",
    "- Per-parcel delta plausibility: savings >40% per parcel needs explicit justification (e.g. a known overpriced legacy carrier). Less than that is normal.",
    "- Status integrity: if status == 'service_tier_gap' or 'no_zone_match', annual_savings MUST be 0 or negative (lane held at current cost). Positive savings on these statuses = block-severity finding.",
    "- Replacement consistency: replacement_carrier field present and matches a carrier from context_confirmation.replacement_carriers when status is 'matched'.",
    "- Zone-level outliers: if one zone within a carrier×service group has a delta wildly different from its peers, flag the row.",
    "- Volume sanity: monthly_shipments per lane should be reasonable vs the tenant's total volume.",
    "Aim for AT LEAST one table_analysis finding per 10 material lanes unless the table is genuinely clean.",
    "",
    "### 3. Methodology fit (category: methodology)",
    "- Density assumption (default 200 kg/m³): is it being applied to lanes that look heavy-freight (heavy-AU industrial) where 200 is too low?",
    "- Lognormal weight distribution: appropriate for this data? Comment if weight bucket counts look forced or empty.",
    "- Fuel mode default: is the chosen default fair to the comparison, or does it flatter one side?",
    "- Unmatched lanes held at current cost: confirm this is surfaced in warnings AND context_confirmation.exclusions.",
    "- Service-tier integrity: no Economy→Express or Express→Economy substitutions buried in the table.",
    "",
    "### 4. Recommendations vs data fit (category: recommendations)",
    "- Each recommendation must trace to a specific lane or carrier in the table. Generic 'renegotiate carrier rates' with no lane reference = warn.",
    "- estimated_impact_aud_per_year should be defensible against the table. If a rec claims $80K but no underlying lane group supports it, flag.",
    "- No double-counting: two recs that target overlapping lanes both claiming full savings = block.",
    "- Are the top-3 dollar opportunities each addressed by a recommendation? If not, flag the gap.",
    "",
    "### 5. Context & narrative (category: context / narrative)",
    "- context_confirmation completeness: any current carrier or replacement carrier missing? Any assumption that's silently in effect but not surfaced?",
    "- analyst_summary consistency: does it name carriers that don't appear in context_confirmation? Does it claim a method that wasn't used?",
    "- confidence_note matches confidence_score and the warnings list.",
    "- framing doesn't oversell or contradict warnings.",
    "- consultant_note on each opportunity references the actual lane mechanic (zone / weight / carrier replacement) — not generic.",
    "",
    "### 6. Customer-facing readiness (category: customer_facing)",
    "This is your overall judgment. The report is customer_facing_ready ONLY if a TAC consultant could share it with a client tomorrow without an awkward defence. Set false if:",
    "- Any block-severity finding fires.",
    "- More than 2 warn-severity findings remain unresolved.",
    "- The report leans on assumptions that aren't surfaced in context_confirmation.",
    "- Unmapped state share > 25% without being prominently flagged.",
    "- Coverage gaps materially affect headline savings without being called out.",
    "- Confidence score < 60 without explicit caveats in confidence_note.",
    "- Major lanes (>10% of volume) are unmatched / held at current cost without explanation.",
    "",
    "## Output shape — return JSON only",
    "",
    "```",
    "{",
    '  "verdict": "pass" | "needs_revision" | "block",',
    '  "customer_facing_ready": boolean,',
    '  "readiness_summary": "2-4 sentence plain English summary",',
    '  "readiness_blockers": ["short bullet label", ...],',
    '  "strengths": ["short bullet label", ...],',
    '  "findings": [',
    "    {",
    '      "severity": "info" | "warn" | "block",',
    '      "category": "math" | "methodology" | "table_analysis" | "recommendations" | "narrative" | "context" | "customer_facing" | "general",',
    '      "claim": "the specific assertion in the report",',
    '      "issue": "what is wrong / what to verify",',
    '      "evidence": "quote the row id, field, or number from the payload",',
    '      "fix": "how to fix or null",',
    '      "linked_section": "json path or null"',
    "    }",
    "  ]",
    "}",
    "```",
    "",
    "## Verdict and readiness rules",
    "",
    "- 'block' verdict: math is wrong, service-tier integrity breached, OR customer_facing_ready=false with severity=block findings.",
    "- 'needs_revision': any warn-severity finding the narrative pass can address (wrong consultant_note, missing caveat, framing overshoot). The narrative pass cannot fix math or table-data issues — those must stay as warnings on the final report.",
    "- 'pass': no warn or block findings. Info findings allowed.",
    "- customer_facing_ready is INDEPENDENT of verdict. A report can be 'pass' on the narrative but customer_facing_ready=false because methodology gaps need consultant follow-up. Be honest.",
    "",
    "## Quality bar",
    "",
    "- Be specific. 'Numbers do not reconcile' is not a finding — '$12,400 in row sums vs $11,900 in headline_savings.monthly_savings_aud' is.",
    "- Every finding must quote evidence (numbers, lane_ids, field paths). 'evidence' is mandatory.",
    "- Tag every finding with category. Default to 'general' only if nothing else fits.",
    "- Strengths: 2-5 short bullets max. Real credibility signals only (e.g. 'weighted CPO, not flat average'; 'unmatched lanes held at current cost — no fabricated rates'). Skip if nothing genuinely strong.",
    "- Readiness blockers: empty array if customer_facing_ready=true. Otherwise list the specific issues a consultant must resolve before sharing.",
    "",
    "## Skill body (context)",
    "",
    skill.skillBody,
  ].join("\n");
}

function buildCriticUserPrompt(
  report: DeterministicReport,
  selfCheck: SelfCheckFinding[]
): string {
  const tableRowCount = report.spend_comparison.table.length;
  const totalMonthly = report.spend_comparison.table.reduce(
    (acc, r) => acc + r.monthly_shipments,
    0
  );
  return [
    "Review the report below. Findings from the deterministic self-check are pre-attached — confirm or expand on them, and add any new issues you find.",
    "",
    "Context:",
    `- spend_comparison.table has ${tableRowCount} rows totalling ${Math.round(totalMonthly)} parcels/month.`,
    `- A 'material' lane is ≥3% of monthly shipments (~${Math.round(totalMonthly * 0.03)} parcels/mo) or contributes meaningfully to annual savings.`,
    "- The deterministic engine owns every numeric field. You do not propose new numbers — you flag the ones that look wrong and quote them as evidence.",
    "",
    "Walk the dimensions in order: math → table_analysis → methodology → recommendations → context/narrative → customer_facing.",
    "",
    "<self_check_findings>",
    JSON.stringify(selfCheck),
    "</self_check_findings>",
    "",
    "<report>",
    JSON.stringify(report),
    "</report>",
    "",
    "Return ONLY the JSON object specified in the system prompt. No prose, no code fences.",
  ].join("\n");
}

function normaliseCriticResponse(value: unknown, revisionCount: number): ReviewResult {
  if (!value || typeof value !== "object") {
    return {
      verdict: "needs_revision",
      revision_count: revisionCount,
      findings: [
        {
          severity: "warn",
          claim: "Critic response was not an object.",
          issue: "Unexpected response shape.",
          evidence: JSON.stringify(value).slice(0, 400),
          fix: null,
          linked_section: null,
          category: "general",
        },
      ],
      customer_facing_ready: false,
      readiness_summary:
        "Critic output could not be parsed — manual review required before sharing.",
      readiness_blockers: ["Critic response unparseable"],
      strengths: [],
    };
  }
  const obj = value as Record<string, unknown>;
  const verdict = parseVerdict(obj.verdict);
  const findings: ReviewFinding[] = [];
  if (Array.isArray(obj.findings)) {
    for (const raw of obj.findings) {
      if (!raw || typeof raw !== "object") continue;
      const f = raw as Record<string, unknown>;
      const severity =
        f.severity === "info" || f.severity === "warn" || f.severity === "block"
          ? f.severity
          : "warn";
      findings.push({
        severity,
        claim: typeof f.claim === "string" ? f.claim : "(unspecified claim)",
        issue: typeof f.issue === "string" ? f.issue : "(unspecified issue)",
        evidence: typeof f.evidence === "string" ? f.evidence : "",
        fix: typeof f.fix === "string" ? f.fix : null,
        linked_section: typeof f.linked_section === "string" ? f.linked_section : null,
        category: parseCategory(f.category),
      });
    }
  }

  const customerFacingReady =
    typeof obj.customer_facing_ready === "boolean"
      ? obj.customer_facing_ready
      : verdict === "pass" && findings.every((f) => f.severity === "info");

  const readinessSummary =
    typeof obj.readiness_summary === "string" && obj.readiness_summary.trim().length > 0
      ? obj.readiness_summary.trim()
      : customerFacingReady
        ? "Critic did not surface unresolved issues — defensible to share with the client."
        : "Critic flagged issues — review findings before sharing.";

  const readinessBlockers = Array.isArray(obj.readiness_blockers)
    ? obj.readiness_blockers
        .filter((b): b is string => typeof b === "string" && b.trim().length > 0)
        .map((b) => b.trim())
    : [];

  const strengths = Array.isArray(obj.strengths)
    ? obj.strengths
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim())
        .slice(0, 5)
    : [];

  return {
    verdict,
    revision_count: revisionCount,
    findings,
    customer_facing_ready: customerFacingReady,
    readiness_summary: readinessSummary,
    readiness_blockers: readinessBlockers,
    strengths,
  };
}

function parseCategory(value: unknown): ReviewCategory {
  if (typeof value === "string" && (REVIEW_CATEGORIES as string[]).includes(value)) {
    return value as ReviewCategory;
  }
  return "general";
}

function parseVerdict(value: unknown): CriticVerdict {
  if (value === "pass" || value === "needs_revision" || value === "block") return value;
  return "needs_revision";
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
  // Closed fence — preferred path.
  const closed = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (closed) return closed[1];
  // Open fence without close (likely truncated mid-output) — strip the prefix
  // and return everything after it so a tolerant parser can attempt repair.
  const opened = raw.match(/```(?:json)?\s*([\s\S]*)$/);
  if (opened) return opened[1];
  return raw;
}
