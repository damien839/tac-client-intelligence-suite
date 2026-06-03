import "server-only";

import type { FreightRateCardLine } from "@/lib/db/types";
import type { RateCardWithLines } from "./snapshot";
import { distributeAcrossBuckets } from "./weight-buckets";

/**
 * Three views of cost the analyzer always computes. Carriers swap one for the
 * other (lower base, higher fuel; vice versa), so we report all three rather
 * than letting a tenant trade cheap-rate-card for high-fuel surprise.
 */
export type FuelMode = "base" | "with_fuel" | "with_all_surcharges";

export const FUEL_MODES: ReadonlyArray<FuelMode> = [
  "base",
  "with_fuel",
  "with_all_surcharges",
];

export interface PricedLine {
  base_aud: number;
  fuel_aud: number;
  surcharges_aud: number;
  total_aud: number;
  rate_card_line_id: string;
  rate_card_id: string;
  zone_label_matched: string;
  weight_kg: number;
}

export type PriceResult =
  | { ok: true; price: PricedLine }
  | { ok: false; reason: PriceFailureReason };

export type PriceFailureReason =
  | "no_zone_match"
  | "no_weight_bracket_match"
  | "rate_card_empty";

export interface PriceLaneOptions {
  /**
   * Per-carrier override for fuel surcharge % when the rate card didn't capture
   * one. Keyed by rate_card_id. Null means "use whatever the card says".
   */
  fuelPctOverridesByCardId?: Record<string, number>;
}

/**
 * Prices a single (rate card × zone × weight) tuple. Pure function — caller
 * decides which rate card to feed in. Service-tier check happens upstream;
 * this function trusts that the card matches the lane's service_level.
 */
export function priceLane(
  card: RateCardWithLines,
  zoneLabel: string,
  weightKg: number,
  fuelMode: FuelMode,
  options: PriceLaneOptions = {}
): PriceResult {
  if (card.lines.length === 0) {
    return { ok: false, reason: "rate_card_empty" };
  }

  const zoneCandidates = matchZoneLines(card.lines, zoneLabel);
  if (zoneCandidates.length === 0) {
    return { ok: false, reason: "no_zone_match" };
  }

  const line = pickWeightBracket(zoneCandidates, weightKg);
  if (!line) {
    return { ok: false, reason: "no_weight_bracket_match" };
  }

  const base = computeBaseRate(line, weightKg);
  const fuelPctOverride = options.fuelPctOverridesByCardId?.[card.id];
  const fuelPct =
    fuelPctOverride != null
      ? fuelPctOverride
      : Number(card.fuel_surcharge_percent ?? 0) || 0;

  const fuel = fuelMode === "base" ? 0 : (base * fuelPct) / 100;
  const surcharges =
    fuelMode === "with_all_surcharges" ? sumExtraSurcharges(card, base) : 0;

  return {
    ok: true,
    price: {
      base_aud: round2(base),
      fuel_aud: round2(fuel),
      surcharges_aud: round2(surcharges),
      total_aud: round2(base + fuel + surcharges),
      rate_card_line_id: line.id,
      rate_card_id: card.id,
      zone_label_matched: line.zone_label,
      weight_kg: weightKg,
    },
  };
}

/**
 * Prices a full lane across the modeled weight distribution and returns a
 * blended cost-per-parcel. This is the headline number used to compare
 * (current carrier × current service) against (new carrier × same service).
 *
 * Returns null when the rate card can't price ANY weight bucket — caller
 * must surface that as a coverage gap, not silently zero out.
 */
export interface BlendedLaneCost {
  cost_per_parcel_aud: number;
  fuel_share_pct: number;
  surcharge_share_pct: number;
  bucket_breakdown: Array<{
    bucket_id: string;
    weight_kg: number;
    share: number;
    base_aud: number;
    fuel_aud: number;
    surcharges_aud: number;
    total_aud: number;
    bracket_matched: boolean;
  }>;
  unpriced_share: number;
}

export function priceLaneBlended(
  card: RateCardWithLines,
  zoneLabel: string,
  avgWeightKg: number | null,
  fuelMode: FuelMode,
  options: PriceLaneOptions = {}
): BlendedLaneCost | null {
  const buckets = distributeAcrossBuckets(avgWeightKg);
  let totalBase = 0;
  let totalFuel = 0;
  let totalSurcharge = 0;
  let priced = 0;
  let unpriced = 0;

  const breakdown: BlendedLaneCost["bucket_breakdown"] = buckets.map((b) => {
    const result = priceLane(card, zoneLabel, b.midpoint_kg, fuelMode, options);
    if (!result.ok) {
      unpriced += b.share;
      return {
        bucket_id: b.id,
        weight_kg: b.midpoint_kg,
        share: b.share,
        base_aud: 0,
        fuel_aud: 0,
        surcharges_aud: 0,
        total_aud: 0,
        bracket_matched: false,
      };
    }
    totalBase += result.price.base_aud * b.share;
    totalFuel += result.price.fuel_aud * b.share;
    totalSurcharge += result.price.surcharges_aud * b.share;
    priced += b.share;
    return {
      bucket_id: b.id,
      weight_kg: b.midpoint_kg,
      share: b.share,
      base_aud: result.price.base_aud,
      fuel_aud: result.price.fuel_aud,
      surcharges_aud: result.price.surcharges_aud,
      total_aud: result.price.total_aud,
      bracket_matched: true,
    };
  });

  if (priced === 0) return null;

  // Re-normalise to the priced share so unpriced buckets don't dilute the avg.
  const denom = priced;
  const cpp = (totalBase + totalFuel + totalSurcharge) / denom;
  const fuelShare = cpp > 0 ? (totalFuel / denom / cpp) * 100 : 0;
  const surchargeShare = cpp > 0 ? (totalSurcharge / denom / cpp) * 100 : 0;

  return {
    cost_per_parcel_aud: round2(cpp),
    fuel_share_pct: round2(fuelShare),
    surcharge_share_pct: round2(surchargeShare),
    bucket_breakdown: breakdown,
    unpriced_share: round4(unpriced),
  };
}

function matchZoneLines(
  lines: FreightRateCardLine[],
  zoneLabel: string
): FreightRateCardLine[] {
  const norm = normalise(zoneLabel);
  if (!norm) return [];

  const exact = lines.filter((l) => normalise(l.zone_label) === norm);
  if (exact.length > 0) return exact;

  const containsBoth = lines.filter((l) => {
    const lz = normalise(l.zone_label);
    return lz.includes(norm) || norm.includes(lz);
  });
  if (containsBoth.length > 0) return containsBoth;

  // Last-ditch: token overlap. "Metro NSW" matches "NSW Metro".
  const tokens = norm.split(/\s+/).filter(Boolean);
  return lines.filter((l) => {
    const lz = normalise(l.zone_label);
    return tokens.some((t) => lz.includes(t));
  });
}

function pickWeightBracket(
  lines: FreightRateCardLine[],
  weightKg: number
): FreightRateCardLine | null {
  const inBracket = lines.find(
    (l) =>
      (l.weight_min_kg == null || weightKg >= Number(l.weight_min_kg)) &&
      (l.weight_max_kg == null || weightKg <= Number(l.weight_max_kg))
  );
  if (inBracket) return inBracket;

  // Beyond the heaviest bracket — pick the heaviest bracket as a fallback.
  // Real carriers throw oversize fees here, but the rate card itself rarely
  // captures that; surfacing as priced-but-with-warning is more useful than null.
  const sorted = [...lines].sort((a, b) => {
    const am = Number(a.weight_max_kg ?? Number.MAX_SAFE_INTEGER);
    const bm = Number(b.weight_max_kg ?? Number.MAX_SAFE_INTEGER);
    return bm - am;
  });
  return sorted[0] ?? null;
}

function computeBaseRate(line: FreightRateCardLine, weightKg: number): number {
  const rate = Number(line.rate_aud) || 0;
  const perKg = Number(line.per_kg_rate_aud ?? 0) || 0;
  const minimum = Number(line.minimum_charge_aud ?? 0) || 0;

  let computed: number;
  switch (line.rate_basis) {
    case "per_parcel":
      computed = rate;
      break;
    case "per_kg":
      computed = rate * weightKg;
      break;
    case "per_parcel_plus_per_kg":
      computed = rate + perKg * weightKg;
      break;
    default:
      computed = rate;
  }
  return Math.max(computed, minimum);
}

function sumExtraSurcharges(card: RateCardWithLines, base: number): number {
  const surcharges = card.surcharges_json;
  if (!surcharges || typeof surcharges !== "object") return 0;
  let total = 0;
  for (const value of Object.values(surcharges as Record<string, unknown>)) {
    if (value == null) continue;
    if (typeof value === "number") {
      total += value;
      continue;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.endsWith("%")) {
        const pct = Number.parseFloat(trimmed.slice(0, -1));
        if (Number.isFinite(pct)) total += (base * pct) / 100;
      } else {
        const flat = Number.parseFloat(trimmed);
        if (Number.isFinite(flat)) total += flat;
      }
      continue;
    }
    if (typeof value === "object") {
      const obj = value as { amount?: unknown; type?: unknown };
      if (typeof obj.amount === "number" && obj.type === "percent") {
        total += (base * obj.amount) / 100;
      } else if (typeof obj.amount === "number") {
        total += obj.amount;
      }
    }
  }
  return total;
}

function normalise(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
