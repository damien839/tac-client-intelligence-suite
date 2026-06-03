import "server-only";

import { runCritic } from "./critic";
import { runDeterministicEngine } from "./engine";
import { applyNarrative } from "./narrative";
import { runSelfCheck } from "./self-check";
import { validateReport } from "./validate-report";
import type { AnalyzerSkill } from "./skill-loader";
import type { AnalyzerSnapshot } from "./snapshot";
import type {
  AnalysisBrief,
  AnalyzerReport,
  DeterministicReport,
  ReviewResult,
  Warning,
} from "./report-types";

export interface PipelineUsage {
  input_tokens: number;
  output_tokens: number;
  model: string;
}

export interface PipelineResult {
  report: AnalyzerReport;
  narrativeUsage: PipelineUsage | null;
  criticUsage: PipelineUsage | null;
  unpriced_lane_count: number;
  duration_ms: number;
  validation_error?: string;
}

const MAX_REVISIONS = 1;

export async function runAnalyzerPipeline(
  snapshot: AnalyzerSnapshot,
  brief: AnalysisBrief,
  skill: AnalyzerSkill
): Promise<PipelineResult> {
  const started = Date.now();

  const { report: engineReport, unpriced_lane_count } = await runDeterministicEngine(
    snapshot,
    brief
  );

  const selfCheck = runSelfCheck(engineReport);

  let working: DeterministicReport = engineReport;
  let narrativeUsage: PipelineUsage | null = null;
  let critic: ReviewResult = {
    verdict: "needs_revision",
    revision_count: 0,
    findings: [],
  };
  let criticUsage: PipelineUsage | null = null;

  if (selfCheck.ok) {
    const narrative = await applyNarrative(working, skill);
    working = narrative.report;
    narrativeUsage = narrative.usage;

    const criticOutcome = await runCritic(working, skill, selfCheck.findings, 0);
    critic = criticOutcome.result;
    criticUsage = criticOutcome.usage;

    let revisionCount = 0;
    while (critic.verdict === "needs_revision" && revisionCount < MAX_REVISIONS) {
      revisionCount += 1;
      const revised = await applyNarrative(working, skill, {
        revisionFeedback: critic.findings,
      });
      working = revised.report;
      narrativeUsage = sumUsage(narrativeUsage, revised.usage);

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

  const warnings = mergeWarnings(working.warnings, selfCheck.findings);

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

  const validation = validateReport(skill.reportSchema, finalReport);
  const validation_error = validation.ok ? undefined : validation.errorSummary ?? "schema validation failed";

  return {
    report: finalReport,
    narrativeUsage,
    criticUsage,
    unpriced_lane_count,
    duration_ms: Date.now() - started,
    validation_error,
  };
}

function sumUsage(a: PipelineUsage | null, b: PipelineUsage | null): PipelineUsage | null {
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
