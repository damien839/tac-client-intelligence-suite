/**
 * Report payload types — mirror skills/final-mile-analyzer/schemas/report.schema.json.
 * Schema is the source of truth at runtime; this type is for the renderer's convenience.
 */

export type ReportState = "final" | "draft_only";
export type WarningSeverity = "info" | "warn" | "block";
export type TenantKind = "client" | "prospect";

export interface ReportHeader {
  tenant_name: string;
  tenant_kind: TenantKind;
  currency: string;
  period_label: string;
  total_monthly_shipments: number;
  current_monthly_spend: number;
  confidence_score: number;
  confidence_note: string;
}

export interface HeadlineSavings {
  annual_savings_aud: number;
  monthly_savings_aud: number;
  savings_pct: number;
  current_annual_spend: number;
  projected_annual_spend: number;
  framing: string;
}

export interface SpendComparisonChartRow {
  label: string;
  current_monthly_spend: number;
  projected_monthly_spend: number;
}

export interface SpendComparisonTableRow {
  carrier: string;
  service_level: string;
  monthly_shipments: number;
  current_cpo: number;
  projected_cpo: number;
  cpo_delta_aud: number;
  cpo_delta_pct: number;
  monthly_savings: number;
  annual_savings: number;
}

export interface SpendComparison {
  chart_data: SpendComparisonChartRow[];
  table: SpendComparisonTableRow[];
}

export interface RegionChartRow {
  region: string;
  current_monthly_spend: number;
  projected_monthly_spend: number;
}

export interface RegionTableRow {
  region: string;
  share_pct: number;
  monthly_shipments: number;
  current_monthly_spend: number;
  projected_monthly_spend: number;
  savings_aud: number;
  savings_pct: number;
}

export interface RegionBreakdown {
  chart_data: RegionChartRow[];
  table: RegionTableRow[];
  unmapped_pct: number;
}

export interface DimRiskLane {
  lane: string;
  avg_weight_kg: number;
  estimated_dim_weight_kg: number;
  note: string;
}

export interface CubeAnalysis {
  total_monthly_cube_m3: number;
  total_annual_cube_m3: number;
  cost_per_m3_current: number;
  cost_per_m3_projected: number;
  density_assumption_kg_per_m3: number;
  estimation_note: string;
  dim_risk_lanes: DimRiskLane[];
}

export interface TopOpportunity {
  rank: number;
  lane: string;
  annual_savings_aud: number;
  per_parcel_delta_aud: number;
  monthly_volume: number;
  consultant_note: string;
}

export interface Recommendation {
  title: string;
  rationale: string;
  estimated_impact_aud_per_year: number | null;
}

export interface Warning {
  code: string;
  severity: WarningSeverity;
  title: string;
  body: string;
  linked_section: string | null;
}

export interface Methodology {
  density_assumption_kg_per_m3: number;
  surcharge_treatment: string;
  unmatched_treatment: string;
  confidence_formula_plain_english: string;
}

export interface AnalyzerReport {
  schema_version: string;
  report_state: ReportState;
  header: ReportHeader;
  headline_savings: HeadlineSavings;
  spend_comparison: SpendComparison;
  region_breakdown: RegionBreakdown;
  cube_analysis: CubeAnalysis;
  top_opportunities: TopOpportunity[];
  recommendations: Recommendation[];
  warnings: Warning[];
  methodology: Methodology;
}
