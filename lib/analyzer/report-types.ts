/**
 * Final Mile Analyzer report payload — v0.2.0.
 *
 * Big shift from v0.1.0: every numeric field comes from the deterministic
 * engine (lib/analyzer/cost.ts + distribution.ts). Claude only produces the
 * narrative strings (framing, consultant_note, rationale, confidence_note)
 * and the critic produces review_findings. Numbers do not depend on the LLM.
 *
 * The schema mirrored at skills/final-mile-analyzer/schemas/report.schema.json
 * is the runtime authority — keep these types in sync.
 */

export const REPORT_SCHEMA_VERSION = "0.4.0";

export type FuelMode = "base" | "with_fuel" | "with_all_surcharges";
export type ReportState = "final" | "draft_only" | "blocked";
export type WarningSeverity = "info" | "warn" | "block";
export type TenantKind = "client" | "prospect";
export type CriticVerdict = "pass" | "needs_revision" | "block";

export interface ContextConfirmationCarrier {
  carrier_code: string;
  carrier_name: string;
  service_levels: string[];
  monthly_shipments: number;
  monthly_spend_aud: number;
}

export interface ContextConfirmationReplacement {
  carrier_code: string;
  carrier_name: string;
  service_levels: string[];
  rate_card_count: number;
}

export interface ContextConfirmation {
  tenant: {
    name: string;
    kind: TenantKind;
    currency: string;
  };
  period: {
    label: string;
  };
  scope: {
    total_monthly_shipments: number;
    lane_count: number;
    state_coverage_count: number;
    unmapped_state_pct: number;
  };
  current_carriers: ContextConfirmationCarrier[];
  replacement_carriers: ContextConfirmationReplacement[];
  assumptions: {
    density_kg_per_m3: number;
    residential_mix_pct: number;
    default_fuel_mode: FuelMode;
    per_carrier_fuel_overrides: Array<{
      carrier_code: string;
      fuel_pct: number;
      note: string | null;
    }>;
    service_tier_pair_override_count: number;
  };
  exclusions: {
    unmatched_lane_count: number;
    unmatched_monthly_shipments: number;
    coverage_gap_count: number;
  };
}

export interface AnalysisBrief {
  period_label: string;
  density_kg_per_m3: number;
  residential_mix_pct: number;
  default_fuel_mode: FuelMode;
  per_carrier_fuel_overrides: Array<{
    carrier_code: string;
    fuel_pct: number;
    note: string | null;
  }>;
  service_tier_pair_overrides: Array<{
    volume_carrier_code: string;
    volume_service_level: string;
    chosen_replacement_rate_card_id: string | null;
  }>;
  notes: string | null;
  excluded_lane_ids?: string[];
}

export interface ReportHeader {
  tenant_name: string;
  tenant_kind: TenantKind;
  currency: string;
  period_label: string;
  total_monthly_shipments: number;
  current_monthly_spend: number;
  confidence_score: number;
  confidence_note: string;
  default_fuel_mode: FuelMode;
}

export interface FuelViewSavings {
  fuel_mode: FuelMode;
  current_monthly_spend: number;
  projected_monthly_spend: number;
  monthly_savings_aud: number;
  annual_savings_aud: number;
  savings_pct: number;
}

export interface SensitivityBand {
  low_annual_aud: number;
  mid_annual_aud: number;
  high_annual_aud: number;
  basis: string;
}

export interface HeadlineSavings {
  default_fuel_mode: FuelMode;
  current_annual_spend: number;
  projected_annual_spend: number;
  annual_savings_aud: number;
  monthly_savings_aud: number;
  savings_pct: number;
  framing: string;
  fuel_views: FuelViewSavings[];
  sensitivity: SensitivityBand;
}

export interface SpendComparisonRow {
  lane_id: string;
  carrier: string;
  carrier_code: string;
  service_level: string;
  zone_label: string;
  monthly_shipments: number;
  avg_weight_kg: number | null;
  current_cpo: number;
  projected_cpo: number;
  cpo_delta_aud: number;
  cpo_delta_pct: number;
  monthly_savings: number;
  annual_savings: number;
  replacement_carrier: string | null;
  replacement_carrier_code: string | null;
  replacement_rate_card_id: string | null;
  status: "matched" | "service_tier_gap" | "no_zone_match" | "partial_coverage";
  coverage_match_pct: number;
}

export interface SpendComparison {
  table: SpendComparisonRow[];
  alternates_by_lane: Record<
    string,
    Array<{
      replacement_carrier: string;
      replacement_carrier_code: string;
      replacement_rate_card_id: string;
      projected_cpo: number;
      monthly_savings: number;
      annual_savings: number;
      coverage_match_pct: number;
    }>
  >;
}

export interface StateBreakdownRow {
  state: string;
  share_pct: number;
  monthly_shipments: number;
  current_monthly_spend: number;
  projected_monthly_spend: number;
  savings_aud: number;
  savings_pct: number;
}

export interface RegionBreakdownRow {
  state: string;
  region: "Metro" | "Regional" | "Remote";
  monthly_shipments: number;
  current_monthly_spend: number;
  projected_monthly_spend: number;
  savings_aud: number;
}

export interface CarrierZoneRow {
  carrier_code: string;
  service_level: string;
  zone_label: string;
  monthly_shipments: number;
  current_monthly_spend: number;
  projected_monthly_spend: number;
  savings_aud: number;
  savings_pct: number;
}

export interface SizeBreakRow {
  bucket_id: string;
  weight_min_kg: number;
  weight_max_kg: number;
  label: string;
  share_pct: number;
  monthly_shipments: number;
  current_avg_cpo: number;
  projected_avg_cpo: number;
  cpo_delta_aud: number;
  monthly_savings: number;
  annual_savings: number;
}

export interface SizeBreakByCarrierCell {
  carrier_code: string;
  bucket_id: string;
  current_avg_cpo: number;
  projected_avg_cpo: number;
  delta_aud: number;
}

export interface DrillDown {
  state_breakdown: StateBreakdownRow[];
  region_breakdown: RegionBreakdownRow[];
  carrier_zone_breakdown: CarrierZoneRow[];
  size_breaks: SizeBreakRow[];
  size_breaks_by_carrier: SizeBreakByCarrierCell[];
  unmapped_state_pct: number;
}

export interface ServiceTierPair {
  service_level: string;
  current_carrier_code: string;
  current_carrier_name: string;
  monthly_shipments: number;
  monthly_spend_aud: number;
  replacements: Array<{
    carrier_code: string;
    carrier_name: string;
    rate_card_id: string;
  }>;
  status: "matched" | "gap_no_equivalent";
}

export interface CoverageGap {
  carrier_code: string;
  service_code: string;
  service_level: string;
  uncovered_postcode_count: number;
  uncovered_state_share: Array<{ state: string; share_pct: number }>;
  exposure_aud_per_month: number;
}

export interface TopOpportunity {
  rank: number;
  lane_id: string;
  lane: string;
  annual_savings_aud: number;
  per_parcel_delta_aud: number;
  monthly_volume: number;
  replacement_carrier: string;
  consultant_note: string;
}

export interface Recommendation {
  title: string;
  rationale: string;
  estimated_impact_aud_per_year: number | null;
  linked_lane_ids: string[];
}

export type ReviewCategory =
  | "math"
  | "methodology"
  | "table_analysis"
  | "recommendations"
  | "narrative"
  | "context"
  | "customer_facing"
  | "general";

export interface ReviewFinding {
  severity: WarningSeverity;
  claim: string;
  issue: string;
  evidence: string;
  fix: string | null;
  linked_section: string | null;
  category?: ReviewCategory;
}

export interface ReviewResult {
  verdict: CriticVerdict;
  revision_count: number;
  findings: ReviewFinding[];
  customer_facing_ready?: boolean;
  readiness_summary?: string;
  readiness_blockers?: string[];
  strengths?: string[];
}

export interface Methodology {
  density_assumption_kg_per_m3: number;
  default_fuel_mode: FuelMode;
  weight_distribution_basis: string;
  postcode_distribution_basis: string;
  surcharge_treatment: string;
  unmatched_treatment: string;
  confidence_formula_plain_english: string;
}

export interface Warning {
  code: string;
  severity: WarningSeverity;
  title: string;
  body: string;
  linked_section: string | null;
}

export interface AnalyzerReport {
  schema_version: typeof REPORT_SCHEMA_VERSION;
  report_state: ReportState;
  brief: AnalysisBrief;
  header: ReportHeader;
  context_confirmation: ContextConfirmation;
  analyst_summary: string;
  headline_savings: HeadlineSavings;
  spend_comparison: SpendComparison;
  drilldown: DrillDown;
  service_tier_pairs: ServiceTierPair[];
  coverage_gaps: CoverageGap[];
  top_opportunities: TopOpportunity[];
  recommendations: Recommendation[];
  warnings: Warning[];
  review: ReviewResult;
  methodology: Methodology;
}

/**
 * The deterministic-only slice of the report — everything the engine produces.
 * Used as input to the narrative/critic Claude calls.
 */
export type DeterministicReport = Omit<
  AnalyzerReport,
  | "review"
> & {
  header: Omit<ReportHeader, "confidence_note"> & {
    confidence_note: string;
  };
  headline_savings: Omit<HeadlineSavings, "framing"> & {
    framing: string;
  };
  top_opportunities: Array<
    Omit<TopOpportunity, "consultant_note"> & { consultant_note: string }
  >;
  recommendations: Recommendation[];
  analyst_summary: string;
  context_confirmation: ContextConfirmation;
};
