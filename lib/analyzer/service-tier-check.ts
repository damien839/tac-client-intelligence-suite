import "server-only";

import type { AnalyzerSnapshot, RateCardWithLines } from "./snapshot";
import type { FreightShipmentVolumeWithCarrier } from "@/lib/db/types";

/**
 * Hard rule: a (carrier × service_level) volume row can only be replaced by a
 * new rate card with the EXACT same canonical service tier. If no equivalent
 * exists we surface a gap — never silently fall back to a different tier.
 *
 * Match key: `canonical_tier` resolved at intake via carrier_service_aliases.
 * Legacy rows without canonical_tier fall back to a case-insensitive match on
 * the raw service_level string — matches the pre-aliases behaviour and lets
 * old data keep working until it's re-imported or backfilled.
 */

export interface ServiceTierPair {
  service_level: string;
  current: {
    carrier_id: string;
    carrier_code: string;
    carrier_name: string;
    monthly_shipments: number;
    monthly_spend_aud: number;
  };
  replacements: Array<{
    carrier_id: string;
    carrier_code: string;
    carrier_name: string;
    rate_card_id: string;
  }>;
  status: "matched" | "gap_no_equivalent";
}

export interface ServiceTierCheckResult {
  pairs: ServiceTierPair[];
  gaps: ServiceTierPair[];
  ok: boolean;
}

export function checkServiceTiers(
  snapshot: AnalyzerSnapshot
): ServiceTierCheckResult {
  const pairs: ServiceTierPair[] = [];

  for (const v of snapshot.volumes) {
    const tierKey = matchKey(v.canonical_tier, v.service_level);
    if (!tierKey) continue;

    const replacements = snapshot.new_rate_cards.filter(
      (card) => matchKey(null, card.service_level) === tierKey
    );

    pairs.push({
      service_level: v.service_level,
      current: {
        carrier_id: v.carrier_id,
        carrier_code: v.carrier.code,
        carrier_name: v.carrier.name,
        monthly_shipments: Number(v.monthly_shipments) || 0,
        monthly_spend_aud:
          (Number(v.monthly_shipments) || 0) * (Number(v.avg_charge_aud) || 0),
      },
      replacements: replacements.map((r) => ({
        carrier_id: r.carrier_id,
        carrier_code: r.carrier.code,
        carrier_name: r.carrier.name,
        rate_card_id: r.id,
      })),
      status: replacements.length === 0 ? "gap_no_equivalent" : "matched",
    });
  }

  const gaps = pairs.filter((p) => p.status === "gap_no_equivalent");
  return {
    pairs,
    gaps,
    ok: gaps.length === 0,
  };
}

/**
 * Picks the best replacement rate card for a volume row, gated on service-tier
 * equivalence. Returns null when no equivalent service exists — caller MUST
 * surface this rather than substitute.
 */
export function findReplacementCards(
  volume: FreightShipmentVolumeWithCarrier,
  newCards: RateCardWithLines[]
): RateCardWithLines[] {
  const tierKey = matchKey(volume.canonical_tier, volume.service_level);
  if (!tierKey) return [];
  return newCards.filter(
    (card) => matchKey(null, card.service_level) === tierKey
  );
}

/**
 * Returns the join key for a volume or rate card row. Prefers the resolved
 * canonical_tier when present (always exact, set at intake); otherwise
 * normalises the raw service_level for legacy rows.
 *
 * Rate cards never carry canonical_tier — their service_level is canonical by
 * construction (the upload UI restricts to SERVICE_LEVEL_OPTIONS). Pass null
 * for the canonical arg when the caller is a rate card.
 */
export function matchKey(
  canonicalTier: string | null | undefined,
  rawServiceLevel: string | null | undefined
): string {
  if (canonicalTier && canonicalTier.trim().length > 0) {
    return canonicalTier.trim().toLowerCase();
  }
  return normaliseTier(rawServiceLevel);
}

export function normaliseTier(value: string | null | undefined): string {
  if (!value) return "";
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
