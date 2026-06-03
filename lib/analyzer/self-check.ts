import "server-only";

import type { DeterministicReport } from "./report-types";

/**
 * Deterministic invariants that the engine output MUST satisfy before we hand
 * the payload to Claude for narrative + critic passes. These are math-level
 * checks the LLM cannot help with — if any of them fire, the report is wrong
 * and we should not paper over it with prose.
 *
 * Each finding has a severity. "block" stops the pipeline; "warn" allows the
 * report through with a banner; "info" is observational only.
 */

export type SelfCheckSeverity = "block" | "warn" | "info";

export interface SelfCheckFinding {
  code: string;
  severity: SelfCheckSeverity;
  message: string;
  expected?: number | string;
  actual?: number | string;
  linked_section?: string | null;
}

export interface SelfCheckResult {
  ok: boolean;
  findings: SelfCheckFinding[];
}

const DOLLAR_TOLERANCE = 1;
const PERCENT_TOLERANCE = 0.5;

export function runSelfCheck(report: DeterministicReport): SelfCheckResult {
  const findings: SelfCheckFinding[] = [];

  checkHeadlineConservation(report, findings);
  checkRowsSumToHeadline(report, findings);
  checkServiceTierIntegrity(report, findings);
  checkOpportunityPositiveSavings(report, findings);
  checkRecommendationsImpact(report, findings);
  checkStateShareTotals(report, findings);
  checkUnmappedShare(report, findings);
  checkFuelViewMonotonicity(report, findings);
  checkConfidenceFloor(report, findings);
  checkSensitivityOrdering(report, findings);

  const blocked = findings.some((f) => f.severity === "block");
  return { ok: !blocked, findings };
}

/**
 * headline.current_annual = projected_annual + annual_savings
 * Same for monthly. Anything else means the engine swapped a number somewhere.
 */
function checkHeadlineConservation(
  report: DeterministicReport,
  findings: SelfCheckFinding[]
): void {
  const h = report.headline_savings;
  const annualGap = h.current_annual_spend - (h.projected_annual_spend + h.annual_savings_aud);
  if (Math.abs(annualGap) > DOLLAR_TOLERANCE * 12) {
    findings.push({
      code: "headline_annual_conservation",
      severity: "block",
      message: "Headline annual conservation broken: current ≠ projected + savings.",
      expected: h.current_annual_spend,
      actual: h.projected_annual_spend + h.annual_savings_aud,
      linked_section: "headline_savings",
    });
  }

  const monthlyGap = h.monthly_savings_aud * 12 - h.annual_savings_aud;
  if (Math.abs(monthlyGap) > DOLLAR_TOLERANCE * 12) {
    findings.push({
      code: "headline_monthly_annual_mismatch",
      severity: "block",
      message: "Monthly savings × 12 does not equal annual savings.",
      expected: h.annual_savings_aud,
      actual: h.monthly_savings_aud * 12,
      linked_section: "headline_savings",
    });
  }
}

/**
 * Sum of per-lane monthly savings should equal headline monthly savings within
 * a small tolerance. If it doesn't, either some lanes were dropped from the
 * table or the headline was computed against a different basis.
 */
function checkRowsSumToHeadline(
  report: DeterministicReport,
  findings: SelfCheckFinding[]
): void {
  const rowsTotal = report.spend_comparison.table.reduce(
    (sum, row) => sum + (row.monthly_savings || 0),
    0
  );
  const headlineMonthly = report.headline_savings.monthly_savings_aud;
  const gap = Math.abs(rowsTotal - headlineMonthly);
  // Allow a per-row rounding budget — table rows are round2'd and there can be
  // many of them. $1 per row is generous but stops drift past that.
  const tolerance = Math.max(DOLLAR_TOLERANCE, report.spend_comparison.table.length);
  if (gap > tolerance) {
    findings.push({
      code: "rows_sum_vs_headline",
      severity: "block",
      message: "Sum of per-lane monthly savings disagrees with headline monthly savings.",
      expected: headlineMonthly,
      actual: rowsTotal,
      linked_section: "spend_comparison",
    });
  }
}

/**
 * Hard rule: a row marked service_tier_gap must NOT have positive savings or a
 * replacement carrier filled in. Gaps surface as exposure, never as wins.
 */
function checkServiceTierIntegrity(
  report: DeterministicReport,
  findings: SelfCheckFinding[]
): void {
  for (const row of report.spend_comparison.table) {
    if (row.status === "service_tier_gap") {
      if (row.replacement_carrier_code || row.replacement_rate_card_id) {
        findings.push({
          code: "service_tier_gap_has_replacement",
          severity: "block",
          message: `Lane ${row.lane_id} is a service-tier gap but has a replacement filled in.`,
          linked_section: "spend_comparison",
        });
      }
      if (row.monthly_savings > 0 || row.annual_savings > 0) {
        findings.push({
          code: "service_tier_gap_has_savings",
          severity: "block",
          message: `Lane ${row.lane_id} is a service-tier gap but reports positive savings.`,
          actual: row.monthly_savings,
          linked_section: "spend_comparison",
        });
      }
    }
  }

  const unresolvedTierGaps = report.service_tier_pairs.filter(
    (p) => p.status === "gap_no_equivalent"
  );
  if (unresolvedTierGaps.length > 0) {
    findings.push({
      code: "service_tier_gap_unresolved",
      severity: "warn",
      message: `${unresolvedTierGaps.length} service-tier pair(s) have no equivalent replacement — surface as exposure, not opportunity.`,
      linked_section: "service_tier_pairs",
    });
  }
}

/**
 * Top opportunities should be positive-savings lanes only — a lane shown as an
 * opportunity must have projected_cpo < current_cpo.
 */
function checkOpportunityPositiveSavings(
  report: DeterministicReport,
  findings: SelfCheckFinding[]
): void {
  const laneIndex = new Map(
    report.spend_comparison.table.map((row) => [row.lane_id, row])
  );
  for (const opp of report.top_opportunities) {
    const row = laneIndex.get(opp.lane_id);
    if (!row) {
      findings.push({
        code: "opportunity_lane_missing",
        severity: "block",
        message: `Top opportunity rank ${opp.rank} references unknown lane ${opp.lane_id}.`,
        linked_section: "top_opportunities",
      });
      continue;
    }
    if (row.projected_cpo > row.current_cpo + 0.01) {
      findings.push({
        code: "opportunity_negative_savings",
        severity: "block",
        message: `Top opportunity rank ${opp.rank} (lane ${opp.lane_id}) shows projected CPO higher than current.`,
        expected: row.current_cpo,
        actual: row.projected_cpo,
        linked_section: "top_opportunities",
      });
    }
    if (opp.annual_savings_aud <= 0) {
      findings.push({
        code: "opportunity_non_positive",
        severity: "block",
        message: `Top opportunity rank ${opp.rank} has non-positive annual savings.`,
        actual: opp.annual_savings_aud,
        linked_section: "top_opportunities",
      });
    }
  }
}

/**
 * Recommendations only ever target positive-saving lanes, so their summed
 * impact should not exceed the *gross* positive annual savings in the table.
 * Comparing against the net headline number is wrong when the overall swap
 * loses money on net (a few profitable lanes inside an otherwise unprofitable
 * comparison still legitimately surface as recommendations).
 */
function checkRecommendationsImpact(
  report: DeterministicReport,
  findings: SelfCheckFinding[]
): void {
  const recImpact = report.recommendations.reduce(
    (sum, r) => sum + (r.estimated_impact_aud_per_year ?? 0),
    0
  );
  const grossPositiveAnnual = report.spend_comparison.table.reduce(
    (sum, row) => sum + (row.annual_savings > 0 ? row.annual_savings : 0),
    0
  );
  if (recImpact > grossPositiveAnnual + DOLLAR_TOLERANCE * 12) {
    findings.push({
      code: "recommendations_exceed_gross_positive_savings",
      severity: "warn",
      message:
        "Sum of recommendation impacts exceeds gross positive annual savings — likely double-counting lanes.",
      expected: grossPositiveAnnual,
      actual: recImpact,
      linked_section: "recommendations",
    });
  }
}

/**
 * State breakdown share_pct should sum to ~100. Deviations beyond
 * PERCENT_TOLERANCE point to a bug in the distribution helper.
 */
function checkStateShareTotals(
  report: DeterministicReport,
  findings: SelfCheckFinding[]
): void {
  const states = report.drilldown.state_breakdown;
  if (states.length === 0) return;
  const total = states.reduce((s, r) => s + (r.share_pct || 0), 0);
  if (Math.abs(total - 100) > PERCENT_TOLERANCE) {
    findings.push({
      code: "state_shares_total",
      severity: "warn",
      message: "State breakdown shares do not sum to ~100%.",
      expected: 100,
      actual: total,
      linked_section: "drilldown.state_breakdown",
    });
  }
}

/**
 * If too much volume couldn't be mapped to a state, the geography drill-down
 * is unreliable. We don't block — we just flag it for the confidence note.
 */
function checkUnmappedShare(
  report: DeterministicReport,
  findings: SelfCheckFinding[]
): void {
  const unmapped = report.drilldown.unmapped_state_pct;
  if (unmapped >= 25) {
    findings.push({
      code: "unmapped_state_high",
      severity: "warn",
      message: `${unmapped.toFixed(1)}% of volume could not be mapped to a state — drill-down is approximate.`,
      actual: unmapped,
      linked_section: "drilldown",
    });
  } else if (unmapped >= 10) {
    findings.push({
      code: "unmapped_state_moderate",
      severity: "info",
      message: `${unmapped.toFixed(1)}% of volume unmapped — surface in confidence note.`,
      actual: unmapped,
      linked_section: "drilldown",
    });
  }
}

/**
 * Across fuel modes, costs should be non-decreasing as we add more surcharges:
 *   base ≤ with_fuel ≤ with_all_surcharges
 * Both for current and projected spend. Savings can swing either way (a card
 * with cheap base but high fuel can flip the comparison), so we only check
 * monotonicity on the absolute spends, not on savings.
 */
function checkFuelViewMonotonicity(
  report: DeterministicReport,
  findings: SelfCheckFinding[]
): void {
  const order = ["base", "with_fuel", "with_all_surcharges"] as const;
  const byMode = new Map(
    report.headline_savings.fuel_views.map((v) => [v.fuel_mode, v])
  );
  for (let i = 1; i < order.length; i++) {
    const prev = byMode.get(order[i - 1]);
    const curr = byMode.get(order[i]);
    if (!prev || !curr) {
      findings.push({
        code: "fuel_view_missing",
        severity: "block",
        message: `Missing fuel view for mode ${!prev ? order[i - 1] : order[i]}.`,
        linked_section: "headline_savings.fuel_views",
      });
      continue;
    }
    if (curr.current_monthly_spend + DOLLAR_TOLERANCE < prev.current_monthly_spend) {
      findings.push({
        code: "fuel_view_current_non_monotonic",
        severity: "warn",
        message: `Current spend decreased from ${prev.fuel_mode} to ${curr.fuel_mode} — surcharges should add cost.`,
        expected: prev.current_monthly_spend,
        actual: curr.current_monthly_spend,
        linked_section: "headline_savings.fuel_views",
      });
    }
    if (curr.projected_monthly_spend + DOLLAR_TOLERANCE < prev.projected_monthly_spend) {
      findings.push({
        code: "fuel_view_projected_non_monotonic",
        severity: "warn",
        message: `Projected spend decreased from ${prev.fuel_mode} to ${curr.fuel_mode}.`,
        expected: prev.projected_monthly_spend,
        actual: curr.projected_monthly_spend,
        linked_section: "headline_savings.fuel_views",
      });
    }
  }
}

/**
 * Confidence ≥ 50 is the threshold we use to call a report "publishable". If
 * any block-severity warnings exist or the unmapped share is high, confidence
 * should not crest 50 — otherwise the header reads more confident than the
 * underlying data justifies.
 */
function checkConfidenceFloor(
  report: DeterministicReport,
  findings: SelfCheckFinding[]
): void {
  const score = report.header.confidence_score;
  const blockingWarnings = report.warnings.filter((w) => w.severity === "block");
  const unmapped = report.drilldown.unmapped_state_pct;
  const tierGaps = report.service_tier_pairs.filter((p) => p.status === "gap_no_equivalent").length;

  if (score >= 50) {
    if (blockingWarnings.length > 0) {
      findings.push({
        code: "confidence_high_with_block_warning",
        severity: "block",
        message: `Confidence ${score} but ${blockingWarnings.length} blocking warning(s) present.`,
        linked_section: "header.confidence_score",
      });
    }
    if (unmapped >= 25 || tierGaps > 0) {
      findings.push({
        code: "confidence_high_with_quarantined_data",
        severity: "warn",
        message: `Confidence ${score} but unmapped=${unmapped.toFixed(1)}% and ${tierGaps} unresolved tier gap(s) — cap confidence below 50.`,
        linked_section: "header.confidence_score",
      });
    }
  }
}

/**
 * sensitivity.low ≤ mid ≤ high. mid should be roughly the headline.
 */
function checkSensitivityOrdering(
  report: DeterministicReport,
  findings: SelfCheckFinding[]
): void {
  const s = report.headline_savings.sensitivity;
  if (s.low_annual_aud > s.mid_annual_aud + DOLLAR_TOLERANCE) {
    findings.push({
      code: "sensitivity_low_above_mid",
      severity: "warn",
      message: "Sensitivity low > mid.",
      linked_section: "headline_savings.sensitivity",
    });
  }
  if (s.mid_annual_aud > s.high_annual_aud + DOLLAR_TOLERANCE) {
    findings.push({
      code: "sensitivity_mid_above_high",
      severity: "warn",
      message: "Sensitivity mid > high.",
      linked_section: "headline_savings.sensitivity",
    });
  }
  const headline = report.headline_savings.annual_savings_aud;
  if (Math.abs(s.mid_annual_aud - headline) > Math.max(DOLLAR_TOLERANCE * 12, headline * 0.05)) {
    findings.push({
      code: "sensitivity_mid_vs_headline",
      severity: "info",
      message: "Sensitivity mid differs from headline annual savings by >5%.",
      expected: headline,
      actual: s.mid_annual_aud,
      linked_section: "headline_savings.sensitivity",
    });
  }
}
