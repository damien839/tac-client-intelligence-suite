import { NextResponse } from "next/server";

import { deleteAnalysis, listAnalysesForTenant } from "@/lib/actions/freight-analyses";
import type { AnalyzerReport } from "@/lib/analyzer/report-types";

export const runtime = "nodejs";

interface AnalysisListItem {
  id: string;
  created_at: string;
  duration_ms: number | null;
  notes: string | null;
  period_label: string | null;
  report_state: AnalyzerReport["report_state"] | null;
  review_verdict: AnalyzerReport["review"]["verdict"] | null;
  annual_savings_aud: number | null;
  monthly_savings_aud: number | null;
  savings_pct: number | null;
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    await deleteAnalysis(id);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantId = url.searchParams.get("tenant_id");
    if (!tenantId) {
      return NextResponse.json({ error: "tenant_id is required" }, { status: 400 });
    }

    const limit = Number(url.searchParams.get("limit") ?? 10);
    const rows = await listAnalysesForTenant(tenantId, Number.isFinite(limit) ? limit : 10);

    const items: AnalysisListItem[] = rows.map((row) => {
      const report = (row.report_json ?? {}) as Partial<AnalyzerReport>;
      const headline = report.headline_savings ?? null;
      return {
        id: row.id,
        created_at: row.created_at,
        duration_ms: row.duration_ms,
        notes: row.notes,
        period_label: report.brief?.period_label ?? null,
        report_state: report.report_state ?? null,
        review_verdict: report.review?.verdict ?? null,
        annual_savings_aud: headline?.annual_savings_aud ?? null,
        monthly_savings_aud: headline?.monthly_savings_aud ?? null,
        savings_pct: headline?.savings_pct ?? null,
      };
    });

    return NextResponse.json({ items });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
