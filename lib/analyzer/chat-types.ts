import type { AnalysisBrief, AnalyzerReport } from "./report-types";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  tool_calls?: ChatToolCall[];
}

export interface ChatToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result_summary: string;
  proposed_brief: AnalysisBrief;
}

export interface ProposeBriefChangeInput {
  density_kg_per_m3?: number;
  residential_mix_pct?: number;
  default_fuel_mode?: "base" | "with_fuel" | "with_all_surcharges";
  add_carrier_fuel_overrides?: Array<{
    carrier_code: string;
    fuel_pct: number;
    note?: string | null;
  }>;
  remove_carrier_fuel_override_codes?: string[];
  exclude_lane_ids?: string[];
  unexclude_lane_ids?: string[];
  notes?: string | null;
  rationale: string;
}

export interface ChatRequestBody {
  analysisId: string;
  pendingBrief: AnalysisBrief | null;
  history: ChatMessage[];
  message: string;
}

export interface ChatResponseBody {
  reply: string;
  toolCalls: ChatToolCall[];
  pendingBrief: AnalysisBrief;
  hasPendingChanges: boolean;
}

export function summariseReportForAgent(report: AnalyzerReport): string {
  // Tight, structured digest the agent reads instead of the full report JSON
  // (the full report is also attached separately as raw context).
  const top5 = [...report.spend_comparison.table]
    .sort((a, b) => b.annual_savings - a.annual_savings)
    .slice(0, 5)
    .map((r) => `${r.lane_id} (${r.monthly_shipments}/mo, CPO $${r.current_cpo}→$${r.projected_cpo}, $${r.annual_savings}/yr)`);
  const bottom5 = [...report.spend_comparison.table]
    .sort((a, b) => a.annual_savings - b.annual_savings)
    .slice(0, 5)
    .map((r) => `${r.lane_id} (${r.monthly_shipments}/mo, CPO $${r.current_cpo}→$${r.projected_cpo}, $${r.annual_savings}/yr)`);
  return [
    `Tenant: ${report.header.tenant_name}`,
    `Period: ${report.header.period_label}`,
    `Total monthly shipments: ${report.header.total_monthly_shipments}`,
    `Annual savings (default fuel): $${report.headline_savings.annual_savings_aud}`,
    `Confidence: ${report.header.confidence_score}/100`,
    `Report state: ${report.report_state}`,
    `Critic verdict: ${report.review.verdict}`,
    `Customer-facing ready: ${report.review.customer_facing_ready ?? "(not set)"}`,
    `Lane count: ${report.spend_comparison.table.length}`,
    "Top 5 savers:",
    ...top5.map((l) => `  - ${l}`),
    "Top 5 losers:",
    ...bottom5.map((l) => `  - ${l}`),
  ].join("\n");
}
