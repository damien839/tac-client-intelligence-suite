import { NextResponse } from "next/server";

import { saveAnalysis } from "@/lib/actions/freight-analyses";
import { getAnthropic } from "@/lib/analyzer/anthropic";
import { normaliseBrief } from "@/lib/analyzer/brief";
import { runCritic } from "@/lib/analyzer/critic";
import { runDeterministicEngine } from "@/lib/analyzer/engine";
import { applyNarrative } from "@/lib/analyzer/narrative";
import { runSelfCheck } from "@/lib/analyzer/self-check";
import { loadAnalyzerSkill } from "@/lib/analyzer/skill-loader";
import { buildAnalyzerSnapshot } from "@/lib/analyzer/snapshot";
import { validateReport } from "@/lib/analyzer/validate-report";
import {
  REPORT_SCHEMA_VERSION,
  type AnalyzerReport,
  type DeterministicReport,
  type ReviewResult,
  type Warning,
} from "@/lib/analyzer/report-types";

export const runtime = "nodejs";
export const maxDuration = 600;

const MAX_REVISIONS = 1;

interface RunRequestBody {
  tenant_id: string;
  brief?: unknown;
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
    if (snapshot.new_rate_cards.length === 0) {
      return NextResponse.json(
        {
          error:
            "No new rate cards loaded for this tenant. Add at least one new rate card to compare against.",
        },
        { status: 400 }
      );
    }

    const brief = normaliseBrief(body.brief, snapshot);

    // Stage 1: deterministic compute
    const { report: engineReport } = await runDeterministicEngine(snapshot, brief);

    // Stage 2: self-check
    const selfCheck = runSelfCheck(engineReport);

    // Stage 3: narrative (only if self-check passed; otherwise the report is
    // wrong at the math level and prose can't save it).
    let working: DeterministicReport = engineReport;
    let narrativeUsage: { input_tokens: number; output_tokens: number; model: string } | null =
      null;
    let critic: ReviewResult = {
      verdict: "needs_revision",
      revision_count: 0,
      findings: [],
    };
    let criticUsage: { input_tokens: number; output_tokens: number; model: string } | null = null;

    if (selfCheck.ok) {
      const narrative = await applyNarrative(working, skill);
      working = narrative.report;
      narrativeUsage = narrative.usage;

      // Stage 4: critic + revise loop
      const criticOutcome = await runCritic(working, skill, selfCheck.findings, 0);
      critic = criticOutcome.result;
      criticUsage = criticOutcome.usage;

      let revisionCount = 0;
      while (critic.verdict === "needs_revision" && revisionCount < MAX_REVISIONS) {
        revisionCount += 1;
        const revisedNarrative = await applyNarrative(working, skill, {
          revisionFeedback: critic.findings,
        });
        working = revisedNarrative.report;
        narrativeUsage = sumUsage(narrativeUsage, revisedNarrative.usage);

        const recheck = await runCritic(working, skill, selfCheck.findings, revisionCount);
        critic = recheck.result;
        criticUsage = sumUsage(criticUsage, recheck.usage);
      }
    } else {
      critic = {
        verdict: "block",
        revision_count: 0,
        findings: selfCheck.findings.map((f) => ({
          severity: f.severity,
          claim: f.code,
          issue: f.message,
          evidence: f.actual != null ? `actual=${f.actual}, expected=${f.expected ?? "n/a"}` : "",
          fix: null,
          linked_section: f.linked_section ?? null,
          category: "math" as const,
        })),
        customer_facing_ready: false,
        readiness_summary:
          "Deterministic self-check failed — the report is mathematically inconsistent. Resolve self-check findings before re-running narrative or sharing.",
        readiness_blockers: selfCheck.findings.map((f) => f.message),
        strengths: [],
      };
    }

    // Apply self-check warnings into the report's warnings array (engine
    // already added domain warnings; we add math-level findings here only if
    // they weren't already included).
    const warnings = mergeWarnings(working.warnings, selfCheck.findings);

    // Compose final AnalyzerReport.
    // report_state precedence: blocked > draft_only > final.
    // The critic's customer_facing_ready=false downgrades to draft_only even if
    // verdict is 'pass' (e.g. methodology gaps the narrative pass can't fix).
    // Partial / no-zone-match against a non-universal replacement carrier is a
    // footprint fact, not a block condition. The only structural block
    // conditions are: critic explicitly blocks, or a block-severity warning
    // was raised (e.g. self-check math failure).
    const isBlocked =
      critic.verdict === "block" ||
      warnings.some((w) => w.severity === "block");
    const isDraft =
      warnings.some((w) => w.severity === "warn") ||
      critic.verdict === "needs_revision" ||
      critic.customer_facing_ready === false;
    const finalReport: AnalyzerReport = {
      ...working,
      warnings,
      report_state: isBlocked ? "blocked" : isDraft ? "draft_only" : "final",
      review: critic,
    };

    // Schema validation (the JSON schema is the runtime authority).
    const validation = validateReport(skill.reportSchema, finalReport);
    if (!validation.ok) {
      return NextResponse.json(
        {
          error: "Final report failed schema validation",
          details: validation.errorSummary,
          report: finalReport,
        },
        { status: 502 }
      );
    }

    const durationMs = Date.now() - started;

    const saved = await saveAnalysis({
      tenant_id: body.tenant_id,
      snapshot_json: snapshot,
      report_json: finalReport,
      schema_version: REPORT_SCHEMA_VERSION,
      model: skill.frontmatter.runtime.report_model,
      tokens_input: (narrativeUsage?.input_tokens ?? 0) + (criticUsage?.input_tokens ?? 0),
      tokens_output: (narrativeUsage?.output_tokens ?? 0) + (criticUsage?.output_tokens ?? 0),
      duration_ms: durationMs,
      notes: body.notes,
    });

    return NextResponse.json({
      id: saved.id,
      report_json: saved.report_json,
      duration_ms: durationMs,
      review_verdict: critic.verdict,
      report_state: finalReport.report_state,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    // touch getAnthropic to keep the import alive when narrative path is
    // skipped — avoids tree-shaking noise in some bundlers.
    void getAnthropic;
  }
}

function sumUsage(
  a: { input_tokens: number; output_tokens: number; model: string } | null,
  b: { input_tokens: number; output_tokens: number; model: string } | null
): { input_tokens: number; output_tokens: number; model: string } | null {
  if (!a) return b;
  if (!b) return a;
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    model: a.model || b.model,
  };
}

function mergeWarnings(
  existing: Warning[],
  selfCheckFindings: ReturnType<typeof runSelfCheck>["findings"]
): Warning[] {
  const out = [...existing];
  const seen = new Set(existing.map((w) => w.code));
  for (const f of selfCheckFindings) {
    if (seen.has(f.code)) continue;
    out.push({
      code: f.code,
      severity: f.severity,
      title: f.message,
      body:
        f.expected != null || f.actual != null
          ? `expected=${f.expected ?? "n/a"}, actual=${f.actual ?? "n/a"}`
          : "Surface in confidence note.",
      linked_section: f.linked_section ?? null,
    });
  }
  return out;
}
