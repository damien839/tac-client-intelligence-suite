import { NextResponse } from "next/server";

import { getAnalysis, saveAnalysis } from "@/lib/actions/freight-analyses";
import { normaliseBrief } from "@/lib/analyzer/brief";
import { runAnalyzerPipeline } from "@/lib/analyzer/pipeline";
import { loadAnalyzerSkill } from "@/lib/analyzer/skill-loader";
import { REPORT_SCHEMA_VERSION, type AnalysisBrief, type AnalyzerReport } from "@/lib/analyzer/report-types";
import { buildAnalyzerSnapshot, type AnalyzerSnapshot } from "@/lib/analyzer/snapshot";

export const runtime = "nodejs";
export const maxDuration = 600;

interface RerunRequestBody {
  parent_analysis_id: string;
  brief: unknown;
  rationale?: string;
  refresh_snapshot?: boolean;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RerunRequestBody;
    if (!body.parent_analysis_id) {
      return NextResponse.json({ error: "parent_analysis_id is required" }, { status: 400 });
    }

    const parent = await getAnalysis(body.parent_analysis_id);
    if (!parent) {
      return NextResponse.json({ error: "Parent analysis not found" }, { status: 404 });
    }

    const frozenSnapshot = parent.snapshot_json as AnalyzerSnapshot;
    if (!frozenSnapshot || !Array.isArray(frozenSnapshot.volumes)) {
      return NextResponse.json({ error: "Parent analysis has no saved snapshot" }, { status: 500 });
    }

    // When refresh_snapshot is set, re-pull the live snapshot for this tenant
    // so newly-mapped service aliases, fresh imports, and corrected rate cards
    // flow into the rerun. Default false to preserve historical reproducibility.
    const snapshot = body.refresh_snapshot
      ? await buildAnalyzerSnapshot(parent.tenant_id)
      : frozenSnapshot;

    if (body.refresh_snapshot && snapshot.volumes.length === 0) {
      return NextResponse.json(
        { error: "Refreshed snapshot has no volumes for this tenant" },
        { status: 400 }
      );
    }

    const skill = await loadAnalyzerSkill();
    const brief: AnalysisBrief = normaliseBrief(body.brief, snapshot);

    const result = await runAnalyzerPipeline(snapshot, brief, skill);
    if (result.validation_error) {
      return NextResponse.json(
        {
          error: "Final report failed schema validation",
          details: result.validation_error,
          report: result.report,
        },
        { status: 502 }
      );
    }

    const parentReport = parent.report_json as AnalyzerReport;
    const briefDiff = computeBriefDiff(parentReport.brief, brief);

    const saved = await saveAnalysis({
      tenant_id: parent.tenant_id,
      snapshot_json: snapshot,
      report_json: result.report,
      schema_version: REPORT_SCHEMA_VERSION,
      model: skill.frontmatter.runtime.report_model,
      tokens_input:
        (result.narrativeUsage?.input_tokens ?? 0) + (result.criticUsage?.input_tokens ?? 0),
      tokens_output:
        (result.narrativeUsage?.output_tokens ?? 0) + (result.criticUsage?.output_tokens ?? 0),
      duration_ms: result.duration_ms,
      notes: body.rationale ?? undefined,
      parent_analysis_id: parent.id,
      brief_changes: briefDiff,
      rerun_rationale: body.rationale ?? undefined,
    });

    return NextResponse.json({
      id: saved.id,
      report_json: saved.report_json,
      duration_ms: result.duration_ms,
      review_verdict: result.report.review.verdict,
      report_state: result.report.report_state,
      snapshot_mode: body.refresh_snapshot ? "refreshed" : "frozen",
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function computeBriefDiff(prev: AnalysisBrief, next: AnalysisBrief): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const keys: (keyof AnalysisBrief)[] = [
    "period_label",
    "density_kg_per_m3",
    "residential_mix_pct",
    "default_fuel_mode",
    "per_carrier_fuel_overrides",
    "service_tier_pair_overrides",
    "notes",
    "excluded_lane_ids",
  ];
  for (const k of keys) {
    const a = JSON.stringify(prev[k] ?? null);
    const b = JSON.stringify(next[k] ?? null);
    if (a !== b) diff[k] = { from: prev[k] ?? null, to: next[k] ?? null };
  }
  return diff;
}
