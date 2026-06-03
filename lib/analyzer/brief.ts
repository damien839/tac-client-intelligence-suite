import "server-only";

import type { AnalysisBrief, FuelMode } from "./report-types";
import type { AnalyzerSnapshot } from "./snapshot";

/**
 * Default brief used when the API caller doesn't supply one. Keeps the run
 * route callable in a "just analyse it" mode while still letting the intake
 * UI override every assumption.
 */
export function buildDefaultBrief(snapshot: AnalyzerSnapshot): AnalysisBrief {
  return {
    period_label: snapshot.volumes[0]?.period_label || defaultPeriodLabel(),
    density_kg_per_m3: 250,
    residential_mix_pct: 75,
    default_fuel_mode: "with_fuel",
    per_carrier_fuel_overrides: [],
    service_tier_pair_overrides: [],
    notes: null,
  };
}

/**
 * Coerces an inbound JSON payload into a valid AnalysisBrief. Falls back to
 * defaults when fields are missing or malformed — never throws on partial
 * input, since the intake UI may post incrementally.
 */
export function normaliseBrief(
  raw: unknown,
  snapshot: AnalyzerSnapshot
): AnalysisBrief {
  const def = buildDefaultBrief(snapshot);
  if (!raw || typeof raw !== "object") return def;
  const obj = raw as Record<string, unknown>;

  const fuelMode = parseFuelMode(obj.default_fuel_mode) ?? def.default_fuel_mode;

  const perCarrierOverrides: AnalysisBrief["per_carrier_fuel_overrides"] = [];
  if (Array.isArray(obj.per_carrier_fuel_overrides)) {
    for (const ov of obj.per_carrier_fuel_overrides) {
      if (!ov || typeof ov !== "object") continue;
      const o = ov as Record<string, unknown>;
      const code = typeof o.carrier_code === "string" ? o.carrier_code : null;
      const pct = typeof o.fuel_pct === "number" ? o.fuel_pct : null;
      if (!code || pct === null) continue;
      perCarrierOverrides.push({
        carrier_code: code,
        fuel_pct: pct,
        note: typeof o.note === "string" ? o.note : null,
      });
    }
  }

  const tierOverrides: AnalysisBrief["service_tier_pair_overrides"] = [];
  if (Array.isArray(obj.service_tier_pair_overrides)) {
    for (const ov of obj.service_tier_pair_overrides) {
      if (!ov || typeof ov !== "object") continue;
      const o = ov as Record<string, unknown>;
      const code = typeof o.volume_carrier_code === "string" ? o.volume_carrier_code : null;
      const lvl = typeof o.volume_service_level === "string" ? o.volume_service_level : null;
      if (!code || !lvl) continue;
      tierOverrides.push({
        volume_carrier_code: code,
        volume_service_level: lvl,
        chosen_replacement_rate_card_id:
          typeof o.chosen_replacement_rate_card_id === "string"
            ? o.chosen_replacement_rate_card_id
            : null,
      });
    }
  }

  const excludedLaneIds = Array.isArray(obj.excluded_lane_ids)
    ? obj.excluded_lane_ids
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim())
    : undefined;

  return {
    period_label:
      typeof obj.period_label === "string" && obj.period_label.trim()
        ? obj.period_label
        : def.period_label,
    density_kg_per_m3:
      typeof obj.density_kg_per_m3 === "number" ? obj.density_kg_per_m3 : def.density_kg_per_m3,
    residential_mix_pct:
      typeof obj.residential_mix_pct === "number"
        ? obj.residential_mix_pct
        : def.residential_mix_pct,
    default_fuel_mode: fuelMode,
    per_carrier_fuel_overrides: perCarrierOverrides,
    service_tier_pair_overrides: tierOverrides,
    notes: typeof obj.notes === "string" ? obj.notes : def.notes,
    ...(excludedLaneIds && excludedLaneIds.length > 0 ? { excluded_lane_ids: excludedLaneIds } : {}),
  };
}

function parseFuelMode(value: unknown): FuelMode | null {
  if (value === "base" || value === "with_fuel" || value === "with_all_surcharges") {
    return value;
  }
  return null;
}

function defaultPeriodLabel(): string {
  const now = new Date();
  return now.toLocaleString("en-AU", { month: "long", year: "numeric" });
}
