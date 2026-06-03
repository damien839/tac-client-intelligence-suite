import "server-only";

import type {
  AnalysisBrief,
  CarrierZoneRow,
  ContextConfirmation,
  ContextConfirmationCarrier,
  ContextConfirmationReplacement,
  CoverageGap,
  DeterministicReport,
  DrillDown,
  FuelMode,
  FuelViewSavings,
  HeadlineSavings,
  Methodology,
  Recommendation,
  RegionBreakdownRow,
  ReportHeader,
  ReportState,
  SensitivityBand,
  ServiceTierPair,
  SizeBreakByCarrierCell,
  SizeBreakRow,
  SpendComparison,
  SpendComparisonRow,
  StateBreakdownRow,
  TopOpportunity,
  Warning,
} from "./report-types";
import { REPORT_SCHEMA_VERSION } from "./report-types";
import type { AnalyzerSnapshot, RateCardWithLines } from "./snapshot";
import { FUEL_MODES, priceLaneBlended } from "./cost";
import {
  STATE_POPULATION_SHARE,
  classifyRegion,
  distributeByState,
  loadCarrierCoveragePostcodes,
  type AuState,
  type PostcodeWeight,
  type RegionKind,
} from "./distribution";
import { findReplacementCards, matchKey, normaliseTier } from "./service-tier-check";
import { WEIGHT_BUCKETS, distributeAcrossBuckets } from "./weight-buckets";
import type { FreightShipmentVolumeWithCarrier } from "@/lib/db/types";

/**
 * Single deterministic pass: snapshot + brief -> DeterministicReport.
 * No LLM involvement. Numbers are produced here; narrative strings are
 * placeholder defaults that the narrative Claude pass will overwrite.
 */

export interface EngineWarning {
  code: string;
  severity: "info" | "warn" | "block";
  title: string;
  body: string;
  linked_section: string | null;
}

export interface EngineResult {
  report: DeterministicReport;
  unpriced_lane_count: number;
}

export async function runDeterministicEngine(
  snapshot: AnalyzerSnapshot,
  brief: AnalysisBrief
): Promise<EngineResult> {
  const warnings: EngineWarning[] = [];
  const fuelOverrides = buildFuelOverrideMap(snapshot, brief);
  const tierOverrideMap = buildTierOverrideMap(brief);

  const excludedLaneSet = new Set(brief.excluded_lane_ids ?? []);
  const includedVolumes = excludedLaneSet.size
    ? snapshot.volumes.filter((v) => !excludedLaneSet.has(makeLaneId(v)))
    : snapshot.volumes;
  const excludedCount = snapshot.volumes.length - includedVolumes.length;

  const totalShipments = includedVolumes.reduce(
    (s, v) => s + (Number(v.monthly_shipments) || 0),
    0
  );
  const actualMonthlySpend = includedVolumes.reduce(
    (s, v) =>
      s + (Number(v.monthly_shipments) || 0) * (Number(v.avg_charge_aud) || 0),
    0
  );

  const lanePricings = includedVolumes.map((volume) =>
    priceLane(volume, snapshot, brief, fuelOverrides, tierOverrideMap)
  );

  if (excludedCount > 0) {
    warnings.push({
      code: "consultant_excluded_lanes",
      severity: "info",
      title: `${excludedCount} lane${excludedCount === 1 ? "" : "s"} excluded by consultant override`,
      body: `Lanes flagged as data artefacts or otherwise out-of-scope have been removed from this projection. Excluded lane ids: ${Array.from(excludedLaneSet).join(", ")}.`,
      linked_section: "context_confirmation",
    });
  }

  const tierPairs = buildServiceTierPairs(snapshot);

  const tierGapWarnings = tierPairs
    .filter((p) => p.status === "gap_no_equivalent")
    .map((p): EngineWarning => ({
      code: "service_tier_gap",
      severity: "warn",
      title: `No same-tier replacement for ${p.current_carrier_name} ${p.service_level}`,
      body: `${p.monthly_shipments.toLocaleString()} monthly shipments worth $${p.monthly_spend_aud.toLocaleString()} have no equivalent service in the new rate cards. Held at current cost in the projection — surface as exposure, not opportunity.`,
      linked_section: "service_tier_pairs",
    }));
  warnings.push(...tierGapWarnings);

  // Footprint, not a problem: replacement carriers (other than Australia Post)
  // serve a subset of postcodes by design. Partial or no zone match for a given
  // lane means the carrier doesn't compete on that lane — it does not mean the
  // analysis is broken. We still count these for downstream metadata, but do
  // not raise a warning. Lanes with no in-footprint replacement naturally fall
  // through to `projected_cpo === current_cpo` and contribute $0 to savings.
  const unpricedCount = lanePricings.filter(
    (lp) => lp.row.status === "no_zone_match"
  ).length;

  const spendComparison = buildSpendComparison(lanePricings);

  const fuelViews = buildFuelViews(lanePricings);
  const defaultView =
    fuelViews.find((v) => v.fuel_mode === brief.default_fuel_mode) ?? fuelViews[1];

  const sensitivity = buildSensitivity(fuelViews, brief.default_fuel_mode);

  const headline: HeadlineSavings = {
    default_fuel_mode: brief.default_fuel_mode,
    current_annual_spend: round2(defaultView.current_monthly_spend * 12),
    projected_annual_spend: round2(defaultView.projected_monthly_spend * 12),
    annual_savings_aud: round2(defaultView.annual_savings_aud),
    monthly_savings_aud: round2(defaultView.monthly_savings_aud),
    savings_pct: defaultView.savings_pct,
    framing: "(narrative pass fills this in)",
    fuel_views: fuelViews,
    sensitivity,
  };

  const drilldown = await buildDrilldown(lanePricings, snapshot, brief, fuelOverrides);

  const coverageGaps = await buildCoverageGaps(lanePricings);

  const opportunities = buildTopOpportunities(spendComparison.table);

  const recommendations = buildBaseRecommendations(spendComparison.table, tierPairs);

  const confidence = computeConfidence({
    headline,
    drilldown,
    tierPairs,
    unpricedCount,
    totalLanes: lanePricings.length,
    blockWarningCount: warnings.filter((w) => w.severity === "block").length,
  });

  const header: ReportHeader = {
    tenant_name: snapshot.tenant.name,
    tenant_kind: snapshot.tenant.kind,
    currency: snapshot.tenant.currency || "AUD",
    period_label: brief.period_label,
    total_monthly_shipments: totalShipments,
    current_monthly_spend: round2(actualMonthlySpend),
    confidence_score: confidence.score,
    confidence_note: confidence.note,
    default_fuel_mode: brief.default_fuel_mode,
  };

  const methodology: Methodology = {
    density_assumption_kg_per_m3: brief.density_kg_per_m3,
    default_fuel_mode: brief.default_fuel_mode,
    weight_distribution_basis:
      "Lognormal distribution with median = avg_weight_kg (or 1.5 kg fallback) and sigma = 0.6 — industry-standard spread for mixed ecom parcels. Tail past 22 kg folded into the top bucket.",
    postcode_distribution_basis:
      "Carrier service-level coverage from carrier_postcode_coverage weighted by AU population shares (ABS 2026). Replaceable by postcode-level volume uploads.",
    surcharge_treatment:
      "All three fuel views (base, with_fuel, with_all_surcharges) computed for both current and projected cost so a tenant cannot trade cheap base rates for high fuel surprise.",
    unmatched_treatment:
      "Lanes with no zone match or only partial coverage in the new rate card are excluded from savings (treated as $0 saved) and surfaced in coverage gaps.",
    confidence_formula_plain_english:
      "Score starts at 100 and is penalised by: unmapped postcodes share, unresolved service-tier gaps, unpriced lanes, low coverage match across the table.",
  };

  const reportState: ReportState =
    warnings.some((w) => w.severity === "block") ? "blocked" : "final";

  const contextConfirmation = buildContextConfirmation({
    snapshot,
    brief,
    header,
    lanePricings,
    drilldown,
    coverageGaps,
  });

  const report: DeterministicReport = {
    schema_version: REPORT_SCHEMA_VERSION,
    report_state: reportState,
    brief,
    header,
    context_confirmation: contextConfirmation,
    analyst_summary: "(narrative pass fills this in)",
    headline_savings: headline,
    spend_comparison: spendComparison,
    drilldown,
    service_tier_pairs: tierPairs,
    coverage_gaps: coverageGaps,
    top_opportunities: opportunities,
    recommendations,
    warnings: warnings.map((w): Warning => ({
      code: w.code,
      severity: w.severity,
      title: w.title,
      body: w.body,
      linked_section: w.linked_section,
    })),
    methodology,
  };

  return { report, unpriced_lane_count: unpricedCount };
}

interface LanePricing {
  volume: FreightShipmentVolumeWithCarrier;
  lane_id: string;
  current_card: RateCardWithLines | null;
  chosen_replacement: RateCardWithLines | null;
  alternates: RateCardWithLines[];
  /** keyed by fuel_mode → { current_cpo, projected_cpo } */
  per_mode: Record<FuelMode, { current_cpo: number; projected_cpo: number; coverage_match_pct: number }>;
  row: SpendComparisonRow;
  /** ranked alternate replacements at default_fuel_mode */
  alternates_pricing: Array<{
    card: RateCardWithLines;
    projected_cpo: number;
    coverage_match_pct: number;
  }>;
}

function priceLane(
  volume: FreightShipmentVolumeWithCarrier,
  snapshot: AnalyzerSnapshot,
  brief: AnalysisBrief,
  fuelOverrides: Record<string, number>,
  tierOverrideMap: Map<string, string | null>
): LanePricing {
  const lane_id = makeLaneId(volume);
  const monthly = Number(volume.monthly_shipments) || 0;
  const avgCharge = Number(volume.avg_charge_aud) || 0;
  const avgWeight = volume.avg_weight_kg != null ? Number(volume.avg_weight_kg) : null;

  const replacements = findReplacementCards(volume, snapshot.new_rate_cards);

  const volumeTierKey = matchKey(volume.canonical_tier, volume.service_level);
  const current_card =
    snapshot.current_rate_cards.find(
      (c) =>
        c.carrier_id === volume.carrier_id &&
        matchKey(null, c.service_level) === volumeTierKey
    ) ?? null;

  if (replacements.length === 0) {
    const empty = blankPerModeAtCharge(avgCharge);
    return {
      volume,
      lane_id,
      current_card,
      chosen_replacement: null,
      alternates: [],
      alternates_pricing: [],
      per_mode: empty,
      row: {
        lane_id,
        carrier: volume.carrier?.name ?? "Unknown",
        carrier_code: volume.carrier?.code ?? "",
        service_level: volume.service_level,
        zone_label: volume.zone_label,
        monthly_shipments: monthly,
        avg_weight_kg: avgWeight,
        current_cpo: round2(avgCharge),
        projected_cpo: round2(avgCharge),
        cpo_delta_aud: 0,
        cpo_delta_pct: 0,
        monthly_savings: 0,
        annual_savings: 0,
        replacement_carrier: null,
        replacement_carrier_code: null,
        replacement_rate_card_id: null,
        status: "service_tier_gap",
        coverage_match_pct: 0,
      },
    };
  }

  // Briefs may key overrides off either the canonical tier or the raw
  // service_level the user saw on screen — try both.
  const carrierCode = volume.carrier?.code ?? "";
  const overrideRateCardId =
    tierOverrideMap.get(`${carrierCode}|${volumeTierKey}`) ??
    tierOverrideMap.get(`${carrierCode}|${normaliseTier(volume.service_level)}`);

  const ranked = replacements
    .map((card) => {
      const blend = priceLaneBlended(
        card,
        volume.zone_label,
        avgWeight,
        brief.default_fuel_mode,
        { fuelPctOverridesByCardId: fuelOverrides }
      );
      return { card, blend };
    })
    .filter((r): r is { card: RateCardWithLines; blend: NonNullable<typeof r.blend> } => r.blend !== null)
    .sort((a, b) => a.blend.cost_per_parcel_aud - b.blend.cost_per_parcel_aud);

  if (ranked.length === 0) {
    return {
      volume,
      lane_id,
      current_card,
      chosen_replacement: null,
      alternates: replacements,
      alternates_pricing: [],
      per_mode: blankPerModeAtCharge(avgCharge),
      row: {
        lane_id,
        carrier: volume.carrier?.name ?? "Unknown",
        carrier_code: volume.carrier?.code ?? "",
        service_level: volume.service_level,
        zone_label: volume.zone_label,
        monthly_shipments: monthly,
        avg_weight_kg: avgWeight,
        current_cpo: round2(avgCharge),
        projected_cpo: round2(avgCharge),
        cpo_delta_aud: 0,
        cpo_delta_pct: 0,
        monthly_savings: 0,
        annual_savings: 0,
        replacement_carrier: null,
        replacement_carrier_code: null,
        replacement_rate_card_id: null,
        status: "no_zone_match",
        coverage_match_pct: 0,
      },
    };
  }

  let chosen = ranked[0];
  if (overrideRateCardId) {
    const override = ranked.find((r) => r.card.id === overrideRateCardId);
    if (override) chosen = override;
  }

  const per_mode: LanePricing["per_mode"] = {} as LanePricing["per_mode"];
  for (const mode of FUEL_MODES) {
    const projectedBlend = priceLaneBlended(
      chosen.card,
      volume.zone_label,
      avgWeight,
      mode,
      { fuelPctOverridesByCardId: fuelOverrides }
    );
    const currentBlend = current_card
      ? priceLaneBlended(current_card, volume.zone_label, avgWeight, mode, {
          fuelPctOverridesByCardId: fuelOverrides,
        })
      : null;

    const projected = projectedBlend?.cost_per_parcel_aud ?? avgCharge;
    const modelledCurrent = currentBlend?.cost_per_parcel_aud ?? null;
    const current = chooseCurrent(mode, modelledCurrent, avgCharge);

    per_mode[mode] = {
      current_cpo: round2(current),
      projected_cpo: round2(projected),
      coverage_match_pct: round2((1 - (projectedBlend?.unpriced_share ?? 0)) * 100),
    };
  }

  const defaultMode = per_mode[brief.default_fuel_mode];
  const cpoDelta = round2(defaultMode.current_cpo - defaultMode.projected_cpo);
  const cpoDeltaPct =
    defaultMode.current_cpo > 0
      ? round2((cpoDelta / defaultMode.current_cpo) * 100)
      : 0;
  const monthlySavings = round2(cpoDelta * monthly);
  const annualSavings = round2(monthlySavings * 12);

  const status: SpendComparisonRow["status"] =
    defaultMode.coverage_match_pct >= 99
      ? "matched"
      : defaultMode.coverage_match_pct > 0
        ? "partial_coverage"
        : "no_zone_match";

  const row: SpendComparisonRow = {
    lane_id,
    carrier: volume.carrier?.name ?? "Unknown",
    carrier_code: volume.carrier?.code ?? "",
    service_level: volume.service_level,
    zone_label: volume.zone_label,
    monthly_shipments: monthly,
    avg_weight_kg: avgWeight,
    current_cpo: defaultMode.current_cpo,
    projected_cpo: defaultMode.projected_cpo,
    cpo_delta_aud: cpoDelta,
    cpo_delta_pct: cpoDeltaPct,
    monthly_savings: monthlySavings,
    annual_savings: annualSavings,
    replacement_carrier: chosen.card.carrier?.name ?? null,
    replacement_carrier_code: chosen.card.carrier?.code ?? null,
    replacement_rate_card_id: chosen.card.id,
    status,
    coverage_match_pct: defaultMode.coverage_match_pct,
  };

  return {
    volume,
    lane_id,
    current_card,
    chosen_replacement: chosen.card,
    alternates: ranked.slice(1).map((r) => r.card),
    alternates_pricing: ranked.slice(1).map((r) => ({
      card: r.card,
      projected_cpo: round2(r.blend.cost_per_parcel_aud),
      coverage_match_pct: round2((1 - r.blend.unpriced_share) * 100),
    })),
    per_mode,
    row,
  };
}

/**
 * If we couldn't model the current rate (no current card stored or no zone
 * match), fall back to the actual avg_charge for the with_fuel mode and to
 * proportional values for the other modes — base and with_all_surcharges
 * become rough adjustments rather than precise figures, which we surface in
 * the confidence note.
 */
function chooseCurrent(
  mode: FuelMode,
  modelled: number | null,
  avgCharge: number
): number {
  if (modelled != null && modelled > 0) return modelled;
  if (mode === "with_fuel") return avgCharge;
  if (mode === "base") return avgCharge * 0.85;
  return avgCharge * 1.07;
}

function blankPerModeAtCharge(avgCharge: number): LanePricing["per_mode"] {
  const out = {} as LanePricing["per_mode"];
  for (const mode of FUEL_MODES) {
    out[mode] = {
      current_cpo: round2(avgCharge),
      projected_cpo: round2(avgCharge),
      coverage_match_pct: 0,
    };
  }
  return out;
}

function buildSpendComparison(lanes: LanePricing[]): SpendComparison {
  const alternates_by_lane: SpendComparison["alternates_by_lane"] = {};
  for (const lane of lanes) {
    if (lane.alternates_pricing.length === 0) continue;
    const monthly = lane.row.monthly_shipments;
    alternates_by_lane[lane.lane_id] = lane.alternates_pricing.map((alt) => {
      const cpoDelta = lane.row.current_cpo - alt.projected_cpo;
      const monthlySavings = round2(cpoDelta * monthly);
      return {
        replacement_carrier: alt.card.carrier?.name ?? "",
        replacement_carrier_code: alt.card.carrier?.code ?? "",
        replacement_rate_card_id: alt.card.id,
        projected_cpo: alt.projected_cpo,
        monthly_savings: monthlySavings,
        annual_savings: round2(monthlySavings * 12),
        coverage_match_pct: alt.coverage_match_pct,
      };
    });
  }
  return {
    table: lanes.map((l) => l.row),
    alternates_by_lane,
  };
}

function buildFuelViews(lanes: LanePricing[]): FuelViewSavings[] {
  return FUEL_MODES.map((mode) => {
    let current = 0;
    let projected = 0;
    for (const lane of lanes) {
      const monthly = lane.row.monthly_shipments;
      if (lane.row.status === "service_tier_gap" || lane.row.status === "no_zone_match") {
        // Surface as exposure: keep current side modelled, but projected = current
        // so savings on these lanes are exactly $0.
        const c = lane.per_mode[mode]?.current_cpo ?? lane.row.current_cpo;
        current += c * monthly;
        projected += c * monthly;
        continue;
      }
      const m = lane.per_mode[mode];
      current += m.current_cpo * monthly;
      projected += m.projected_cpo * monthly;
    }
    const savings = current - projected;
    return {
      fuel_mode: mode,
      current_monthly_spend: round2(current),
      projected_monthly_spend: round2(projected),
      monthly_savings_aud: round2(savings),
      annual_savings_aud: round2(savings * 12),
      savings_pct: current > 0 ? round2((savings / current) * 100) : 0,
    };
  });
}

function buildSensitivity(
  fuelViews: FuelViewSavings[],
  defaultMode: FuelMode
): SensitivityBand {
  const annuals = fuelViews.map((v) => v.annual_savings_aud);
  const mid = fuelViews.find((v) => v.fuel_mode === defaultMode)?.annual_savings_aud
    ?? annuals[1];
  const low = Math.min(...annuals);
  const high = Math.max(...annuals);
  return {
    low_annual_aud: round2(low),
    mid_annual_aud: round2(mid),
    high_annual_aud: round2(high),
    basis:
      "Range across fuel modes (base / with fuel / with all surcharges) using the same chosen replacement card per lane.",
  };
}

function buildServiceTierPairs(snapshot: AnalyzerSnapshot): ServiceTierPair[] {
  const out: ServiceTierPair[] = [];
  const seen = new Set<string>();
  for (const v of snapshot.volumes) {
    const tierKey = matchKey(v.canonical_tier, v.service_level);
    const key = `${v.carrier_id}|${tierKey}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const replacements = findReplacementCards(v, snapshot.new_rate_cards);
    const matchingVols = snapshot.volumes.filter(
      (vv) =>
        vv.carrier_id === v.carrier_id &&
        matchKey(vv.canonical_tier, vv.service_level) === tierKey
    );
    const monthly = matchingVols.reduce(
      (s, vv) => s + (Number(vv.monthly_shipments) || 0),
      0
    );
    const spend = matchingVols.reduce(
      (s, vv) =>
        s + (Number(vv.monthly_shipments) || 0) * (Number(vv.avg_charge_aud) || 0),
      0
    );

    out.push({
      service_level: v.service_level,
      current_carrier_code: v.carrier?.code ?? "",
      current_carrier_name: v.carrier?.name ?? "",
      monthly_shipments: monthly,
      monthly_spend_aud: round2(spend),
      replacements: replacements.map((r) => ({
        carrier_code: r.carrier?.code ?? "",
        carrier_name: r.carrier?.name ?? "",
        rate_card_id: r.id,
      })),
      status: replacements.length === 0 ? "gap_no_equivalent" : "matched",
    });
  }
  return out;
}

async function buildDrilldown(
  lanes: LanePricing[],
  snapshot: AnalyzerSnapshot,
  brief: AnalysisBrief,
  fuelOverrides: Record<string, number>
): Promise<DrillDown> {
  const stateAcc = new Map<
    AuState,
    {
      monthly_shipments: number;
      current_monthly_spend: number;
      projected_monthly_spend: number;
    }
  >();
  const regionAcc = new Map<
    string,
    {
      state: AuState;
      region: RegionKind;
      monthly_shipments: number;
      current_monthly_spend: number;
      projected_monthly_spend: number;
    }
  >();
  const carrierZoneAcc = new Map<
    string,
    {
      carrier_code: string;
      service_level: string;
      zone_label: string;
      monthly_shipments: number;
      current_monthly_spend: number;
      projected_monthly_spend: number;
    }
  >();

  let unmappedShipments = 0;
  let totalShipments = 0;

  for (const lane of lanes) {
    const monthly = lane.row.monthly_shipments;
    totalShipments += monthly;

    const region = classifyRegion(lane.row.zone_label);
    const currentSpend = lane.row.current_cpo * monthly;
    const projectedSpend = lane.row.projected_cpo * monthly;

    const distribution = await getCachedDistribution(
      lane.volume.carrier?.code ?? "",
      lane.volume.service_level,
      coverageCache
    );

    if (distribution.length === 0) {
      unmappedShipments += monthly;
    } else {
      for (const d of distribution) {
        const stateRow = stateAcc.get(d.state) ?? {
          monthly_shipments: 0,
          current_monthly_spend: 0,
          projected_monthly_spend: 0,
        };
        stateRow.monthly_shipments += monthly * d.share;
        stateRow.current_monthly_spend += currentSpend * d.share;
        stateRow.projected_monthly_spend += projectedSpend * d.share;
        stateAcc.set(d.state, stateRow);

        const regionKey = `${d.state}|${region}`;
        const regionRow = regionAcc.get(regionKey) ?? {
          state: d.state,
          region,
          monthly_shipments: 0,
          current_monthly_spend: 0,
          projected_monthly_spend: 0,
        };
        regionRow.monthly_shipments += monthly * d.share;
        regionRow.current_monthly_spend += currentSpend * d.share;
        regionRow.projected_monthly_spend += projectedSpend * d.share;
        regionAcc.set(regionKey, regionRow);
      }
    }

    const czKey = `${lane.row.carrier_code}|${lane.row.service_level}|${lane.row.zone_label}`;
    const czRow = carrierZoneAcc.get(czKey) ?? {
      carrier_code: lane.row.carrier_code,
      service_level: lane.row.service_level,
      zone_label: lane.row.zone_label,
      monthly_shipments: 0,
      current_monthly_spend: 0,
      projected_monthly_spend: 0,
    };
    czRow.monthly_shipments += monthly;
    czRow.current_monthly_spend += currentSpend;
    czRow.projected_monthly_spend += projectedSpend;
    carrierZoneAcc.set(czKey, czRow);
  }

  const totalShipForShare = totalShipments - unmappedShipments;
  const state_breakdown: StateBreakdownRow[] = Array.from(stateAcc.entries())
    .map(([state, v]): StateBreakdownRow => {
      const savings = v.current_monthly_spend - v.projected_monthly_spend;
      return {
        state,
        share_pct:
          totalShipForShare > 0
            ? round2((v.monthly_shipments / totalShipForShare) * 100)
            : 0,
        monthly_shipments: round2(v.monthly_shipments),
        current_monthly_spend: round2(v.current_monthly_spend),
        projected_monthly_spend: round2(v.projected_monthly_spend),
        savings_aud: round2(savings),
        savings_pct:
          v.current_monthly_spend > 0
            ? round2((savings / v.current_monthly_spend) * 100)
            : 0,
      };
    })
    .sort((a, b) => b.monthly_shipments - a.monthly_shipments);

  const region_breakdown: RegionBreakdownRow[] = Array.from(regionAcc.values())
    .map((v): RegionBreakdownRow => ({
      state: v.state,
      region: v.region,
      monthly_shipments: round2(v.monthly_shipments),
      current_monthly_spend: round2(v.current_monthly_spend),
      projected_monthly_spend: round2(v.projected_monthly_spend),
      savings_aud: round2(v.current_monthly_spend - v.projected_monthly_spend),
    }))
    .sort((a, b) => b.monthly_shipments - a.monthly_shipments);

  const carrier_zone_breakdown: CarrierZoneRow[] = Array.from(carrierZoneAcc.values())
    .map((v): CarrierZoneRow => {
      const savings = v.current_monthly_spend - v.projected_monthly_spend;
      return {
        carrier_code: v.carrier_code,
        service_level: v.service_level,
        zone_label: v.zone_label,
        monthly_shipments: v.monthly_shipments,
        current_monthly_spend: round2(v.current_monthly_spend),
        projected_monthly_spend: round2(v.projected_monthly_spend),
        savings_aud: round2(savings),
        savings_pct:
          v.current_monthly_spend > 0
            ? round2((savings / v.current_monthly_spend) * 100)
            : 0,
      };
    })
    .sort((a, b) => b.savings_aud - a.savings_aud);

  const { size_breaks, size_breaks_by_carrier } = buildSizeBreaks(
    lanes,
    snapshot,
    brief,
    fuelOverrides
  );

  return {
    state_breakdown,
    region_breakdown,
    carrier_zone_breakdown,
    size_breaks,
    size_breaks_by_carrier,
    unmapped_state_pct:
      totalShipments > 0
        ? round2((unmappedShipments / totalShipments) * 100)
        : 0,
  };
}

const coverageCache = new Map<string, Array<{ state: AuState; share: number }>>();

async function getCachedDistribution(
  carrierCode: string,
  serviceCode: string,
  cache: Map<string, Array<{ state: AuState; share: number }>>
): Promise<Array<{ state: AuState; share: number }>> {
  const key = `${carrierCode}|${serviceCode}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let postcodes: PostcodeWeight[] = [];
  try {
    postcodes = await loadCarrierCoveragePostcodes(carrierCode, serviceCode);
  } catch {
    postcodes = [];
  }
  if (postcodes.length === 0) {
    // Fallback to AU-wide population shares when carrier coverage is unknown.
    const fallback = (Object.entries(STATE_POPULATION_SHARE) as [AuState, number][])
      .map(([state, share]) => ({ state, share }));
    cache.set(key, fallback);
    return fallback;
  }
  const dist = distributeByState(postcodes).map((d) => ({ state: d.state, share: d.share }));
  cache.set(key, dist);
  return dist;
}

function buildSizeBreaks(
  lanes: LanePricing[],
  snapshot: AnalyzerSnapshot,
  brief: AnalysisBrief,
  fuelOverrides: Record<string, number>
): { size_breaks: SizeBreakRow[]; size_breaks_by_carrier: SizeBreakByCarrierCell[] } {
  const totals = new Map<
    string,
    {
      monthly_shipments: number;
      current_cost: number;
      projected_cost: number;
    }
  >();
  for (const b of WEIGHT_BUCKETS) {
    totals.set(b.id, { monthly_shipments: 0, current_cost: 0, projected_cost: 0 });
  }

  const perCarrier = new Map<
    string,
    {
      carrier_code: string;
      bucket_id: string;
      shipments: number;
      current_cost: number;
      projected_cost: number;
    }
  >();

  for (const lane of lanes) {
    const monthly = lane.row.monthly_shipments;
    const buckets = distributeAcrossBuckets(lane.row.avg_weight_kg);
    const replacement = lane.chosen_replacement;
    const currentCard = lane.current_card;
    for (const b of buckets) {
      const shipments = monthly * b.share;
      let projectedCpo = lane.row.projected_cpo;
      if (replacement) {
        const blend = priceLaneBlended(
          replacement,
          lane.row.zone_label,
          b.midpoint_kg,
          brief.default_fuel_mode,
          { fuelPctOverridesByCardId: fuelOverrides }
        );
        if (blend) projectedCpo = blend.cost_per_parcel_aud;
      }
      let currentCpo = lane.row.current_cpo;
      if (currentCard) {
        const blend = priceLaneBlended(
          currentCard,
          lane.row.zone_label,
          b.midpoint_kg,
          brief.default_fuel_mode,
          { fuelPctOverridesByCardId: fuelOverrides }
        );
        if (blend) currentCpo = blend.cost_per_parcel_aud;
      }

      const t = totals.get(b.id)!;
      t.monthly_shipments += shipments;
      t.current_cost += shipments * currentCpo;
      t.projected_cost += shipments * projectedCpo;

      const pcKey = `${lane.row.carrier_code}|${b.id}`;
      const pc = perCarrier.get(pcKey) ?? {
        carrier_code: lane.row.carrier_code,
        bucket_id: b.id,
        shipments: 0,
        current_cost: 0,
        projected_cost: 0,
      };
      pc.shipments += shipments;
      pc.current_cost += shipments * currentCpo;
      pc.projected_cost += shipments * projectedCpo;
      perCarrier.set(pcKey, pc);
    }
  }

  const totalMonthly =
    Array.from(totals.values()).reduce((s, t) => s + t.monthly_shipments, 0) || 1;

  const size_breaks: SizeBreakRow[] = WEIGHT_BUCKETS.map((b): SizeBreakRow => {
    const t = totals.get(b.id)!;
    const currentAvg = t.monthly_shipments > 0 ? t.current_cost / t.monthly_shipments : 0;
    const projectedAvg = t.monthly_shipments > 0 ? t.projected_cost / t.monthly_shipments : 0;
    const monthlySavings = t.current_cost - t.projected_cost;
    return {
      bucket_id: b.id,
      weight_min_kg: b.min_kg,
      weight_max_kg: b.max_kg,
      label: b.label,
      share_pct: round2((t.monthly_shipments / totalMonthly) * 100),
      monthly_shipments: round2(t.monthly_shipments),
      current_avg_cpo: round2(currentAvg),
      projected_avg_cpo: round2(projectedAvg),
      cpo_delta_aud: round2(currentAvg - projectedAvg),
      monthly_savings: round2(monthlySavings),
      annual_savings: round2(monthlySavings * 12),
    };
  });

  const size_breaks_by_carrier: SizeBreakByCarrierCell[] = Array.from(perCarrier.values()).map(
    (v): SizeBreakByCarrierCell => {
      const currentAvg = v.shipments > 0 ? v.current_cost / v.shipments : 0;
      const projectedAvg = v.shipments > 0 ? v.projected_cost / v.shipments : 0;
      return {
        carrier_code: v.carrier_code,
        bucket_id: v.bucket_id,
        current_avg_cpo: round2(currentAvg),
        projected_avg_cpo: round2(projectedAvg),
        delta_aud: round2(currentAvg - projectedAvg),
      };
    }
  );

  return { size_breaks, size_breaks_by_carrier };
}

async function buildCoverageGaps(lanes: LanePricing[]): Promise<CoverageGap[]> {
  const seen = new Set<string>();
  const out: CoverageGap[] = [];
  for (const lane of lanes) {
    const card = lane.chosen_replacement;
    if (!card) continue;
    const key = `${card.carrier?.code ?? ""}|${normaliseTier(card.service_level)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if ((lane.per_mode[lane.volume ? "with_fuel" : "with_fuel"]?.coverage_match_pct ?? 100) >= 99) {
      continue;
    }
    // Unmatched share approximated from coverage_match_pct.
    const matchPct = lane.per_mode["with_fuel"]?.coverage_match_pct ?? 100;
    const uncoveredShare = Math.max(0, (100 - matchPct) / 100);
    if (uncoveredShare === 0) continue;
    const exposure = lane.row.monthly_shipments * lane.row.current_cpo * uncoveredShare;
    out.push({
      carrier_code: card.carrier?.code ?? "",
      service_code: card.service_level,
      service_level: card.service_level,
      uncovered_postcode_count: 0, // populated downstream when we have postcode-level data
      uncovered_state_share: [],
      exposure_aud_per_month: round2(exposure),
    });
  }
  return out;
}

function buildTopOpportunities(rows: SpendComparisonRow[]): TopOpportunity[] {
  return [...rows]
    .filter((r) => r.annual_savings > 0 && r.replacement_carrier)
    .sort((a, b) => b.annual_savings - a.annual_savings)
    .slice(0, 5)
    .map((r, idx): TopOpportunity => ({
      rank: idx + 1,
      lane_id: r.lane_id,
      lane: `${r.carrier} ${r.service_level} → ${r.replacement_carrier} (${r.zone_label})`,
      annual_savings_aud: r.annual_savings,
      per_parcel_delta_aud: r.cpo_delta_aud,
      monthly_volume: r.monthly_shipments,
      replacement_carrier: r.replacement_carrier ?? "",
      consultant_note: "(narrative pass fills this in)",
    }));
}

function buildBaseRecommendations(
  rows: SpendComparisonRow[],
  tierPairs: ServiceTierPair[]
): Recommendation[] {
  const out: Recommendation[] = [];
  const positive = rows.filter((r) => r.annual_savings > 0);
  if (positive.length > 0) {
    const total = positive.reduce((s, r) => s + r.annual_savings, 0);
    out.push({
      title: "Switch positive-saving lanes to chosen replacement carriers",
      rationale: "(narrative pass fills this in)",
      estimated_impact_aud_per_year: round2(total),
      linked_lane_ids: positive.map((r) => r.lane_id),
    });
  }
  const gaps = tierPairs.filter((p) => p.status === "gap_no_equivalent");
  if (gaps.length > 0) {
    out.push({
      title: "Resolve service-tier gaps before switching",
      rationale: "(narrative pass fills this in)",
      estimated_impact_aud_per_year: null,
      linked_lane_ids: [],
    });
  }
  return out;
}

interface ConfidenceInputs {
  headline: HeadlineSavings;
  drilldown: DrillDown;
  tierPairs: ServiceTierPair[];
  unpricedCount: number;
  totalLanes: number;
  blockWarningCount: number;
}

function computeConfidence(input: ConfidenceInputs): { score: number; note: string } {
  let score = 100;
  const reasons: string[] = [];

  const unmapped = input.drilldown.unmapped_state_pct;
  if (unmapped > 0) {
    const penalty = Math.min(40, Math.round(unmapped));
    score -= penalty;
    reasons.push(`${unmapped.toFixed(1)}% of volume unmapped to state (-${penalty})`);
  }

  const gaps = input.tierPairs.filter((p) => p.status === "gap_no_equivalent").length;
  if (gaps > 0) {
    const penalty = Math.min(30, gaps * 10);
    score -= penalty;
    reasons.push(`${gaps} unresolved service-tier gap(s) (-${penalty})`);
  }

  if (input.totalLanes > 0 && input.unpricedCount > 0) {
    const ratio = input.unpricedCount / input.totalLanes;
    const penalty = Math.min(25, Math.round(ratio * 50));
    score -= penalty;
    reasons.push(`${input.unpricedCount}/${input.totalLanes} lanes unpriced (-${penalty})`);
  }

  // Hard cap when any block-severity warning is present — the report is not
  // publishable regardless of how clean the other inputs are.
  if (input.blockWarningCount > 0) {
    if (score >= 50) {
      score = 49;
      reasons.push(
        `${input.blockWarningCount} blocking warning(s) — score capped at 49`
      );
    } else {
      reasons.push(
        `${input.blockWarningCount} blocking warning(s) present`
      );
    }
  }

  score = Math.max(0, Math.min(100, score));
  const note = reasons.length === 0 ? "All inputs cleanly resolved." : reasons.join("; ");
  return { score, note };
}

interface ContextConfirmationInputs {
  snapshot: AnalyzerSnapshot;
  brief: AnalysisBrief;
  header: ReportHeader;
  lanePricings: LanePricing[];
  drilldown: DrillDown;
  coverageGaps: CoverageGap[];
}

function buildContextConfirmation(
  input: ContextConfirmationInputs
): ContextConfirmation {
  const { snapshot, brief, header, lanePricings, drilldown, coverageGaps } = input;

  const currentByCode = new Map<string, ContextConfirmationCarrier>();
  for (const v of snapshot.volumes) {
    const code = v.carrier?.code ?? "";
    const name = v.carrier?.name ?? "Unknown";
    const tier = (v.service_level ?? "").trim() || "—";
    const monthly = Number(v.monthly_shipments) || 0;
    const spend = monthly * (Number(v.avg_charge_aud) || 0);
    const existing = currentByCode.get(code);
    if (existing) {
      if (!existing.service_levels.includes(tier)) existing.service_levels.push(tier);
      existing.monthly_shipments += monthly;
      existing.monthly_spend_aud += spend;
    } else {
      currentByCode.set(code, {
        carrier_code: code,
        carrier_name: name,
        service_levels: [tier],
        monthly_shipments: monthly,
        monthly_spend_aud: spend,
      });
    }
  }
  const currentCarriers = Array.from(currentByCode.values())
    .map((c) => ({
      ...c,
      service_levels: [...c.service_levels].sort(),
      monthly_shipments: round2(c.monthly_shipments),
      monthly_spend_aud: round2(c.monthly_spend_aud),
    }))
    .sort((a, b) => b.monthly_spend_aud - a.monthly_spend_aud);

  const replacementByCode = new Map<string, ContextConfirmationReplacement>();
  for (const card of snapshot.new_rate_cards) {
    const code = card.carrier?.code ?? "";
    const name = card.carrier?.name ?? "Unknown";
    const tier = (card.service_level ?? "").trim() || "—";
    const existing = replacementByCode.get(code);
    if (existing) {
      if (!existing.service_levels.includes(tier)) existing.service_levels.push(tier);
      existing.rate_card_count += 1;
    } else {
      replacementByCode.set(code, {
        carrier_code: code,
        carrier_name: name,
        service_levels: [tier],
        rate_card_count: 1,
      });
    }
  }
  const replacementCarriers = Array.from(replacementByCode.values())
    .map((c) => ({ ...c, service_levels: [...c.service_levels].sort() }))
    .sort((a, b) => a.carrier_name.localeCompare(b.carrier_name));

  const unmatchedLanes = lanePricings.filter(
    (lp) =>
      lp.row.status === "no_zone_match" ||
      lp.row.status === "service_tier_gap" ||
      lp.row.status === "partial_coverage"
  );
  const unmatchedShipments = unmatchedLanes.reduce(
    (s, lp) => s + (lp.row.monthly_shipments || 0),
    0
  );

  return {
    tenant: {
      name: snapshot.tenant.name,
      kind: snapshot.tenant.kind,
      currency: snapshot.tenant.currency || "AUD",
    },
    period: { label: brief.period_label },
    scope: {
      total_monthly_shipments: header.total_monthly_shipments,
      lane_count: lanePricings.length,
      state_coverage_count: drilldown.state_breakdown.length,
      unmapped_state_pct: drilldown.unmapped_state_pct,
    },
    current_carriers: currentCarriers,
    replacement_carriers: replacementCarriers,
    assumptions: {
      density_kg_per_m3: brief.density_kg_per_m3,
      residential_mix_pct: brief.residential_mix_pct,
      default_fuel_mode: brief.default_fuel_mode,
      per_carrier_fuel_overrides: brief.per_carrier_fuel_overrides.map((o) => ({
        carrier_code: o.carrier_code,
        fuel_pct: o.fuel_pct,
        note: o.note,
      })),
      service_tier_pair_override_count: brief.service_tier_pair_overrides.length,
    },
    exclusions: {
      unmatched_lane_count: unmatchedLanes.length,
      unmatched_monthly_shipments: round2(unmatchedShipments),
      coverage_gap_count: coverageGaps.length,
    },
  };
}

function buildFuelOverrideMap(
  snapshot: AnalyzerSnapshot,
  brief: AnalysisBrief
): Record<string, number> {
  const map: Record<string, number> = {};
  const carriersByCode = new Map<string, string>();
  for (const card of [...snapshot.current_rate_cards, ...snapshot.new_rate_cards]) {
    const code = card.carrier?.code;
    if (code) carriersByCode.set(code, card.id);
  }
  for (const ov of brief.per_carrier_fuel_overrides) {
    for (const card of [...snapshot.current_rate_cards, ...snapshot.new_rate_cards]) {
      if (card.carrier?.code === ov.carrier_code) {
        map[card.id] = ov.fuel_pct;
      }
    }
  }
  return map;
}

function buildTierOverrideMap(brief: AnalysisBrief): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const ov of brief.service_tier_pair_overrides) {
    // Overrides come from the brief carrying the raw service_level the user
    // saw on screen. Run it through normaliseTier — overrides predate the
    // alias system, so they don't have a canonical_tier to lean on.
    const key = `${ov.volume_carrier_code}|${normaliseTier(ov.volume_service_level)}`;
    map.set(key, ov.chosen_replacement_rate_card_id);
  }
  return map;
}

function makeLaneId(volume: FreightShipmentVolumeWithCarrier): string {
  const code = volume.carrier?.code ?? "UNK";
  const tier = matchKey(volume.canonical_tier, volume.service_level).replace(/\s+/g, "-");
  const zone = (volume.zone_label || "no-zone").trim().toLowerCase().replace(/\s+/g, "-");
  return `${code}|${tier}|${zone}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
