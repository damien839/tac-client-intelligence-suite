import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Postcode-level volume isn't captured today (Option A), so when a volume row
 * says "1,200 Express shipments via AusPost to Metro", we model how those
 * shipments distribute across postcodes / states / regions using:
 *   1. carrier_postcode_coverage  — which postcodes the carrier actually serves
 *   2. AU population shares       — how parcels actually distribute across them
 *
 * The model is replaceable: if a tenant later uploads postcode-level volume,
 * the override goes here. Until then this is the deterministic best-guess.
 */

export type AuState =
  | "NSW"
  | "VIC"
  | "QLD"
  | "SA"
  | "WA"
  | "TAS"
  | "NT"
  | "ACT";

/** AU resident population share by state — ABS 2026 estimates (rounded). */
export const STATE_POPULATION_SHARE: Record<AuState, number> = {
  NSW: 0.314,
  VIC: 0.260,
  QLD: 0.205,
  WA: 0.105,
  SA: 0.069,
  TAS: 0.022,
  ACT: 0.018,
  NT: 0.007,
};

export type RegionKind = "Metro" | "Regional" | "Remote";

/**
 * Maps an AU postcode to its state. Handles the Canberra / NSW border quirks
 * (ACT postcodes 2600–2618, 2900–2920, 0200–0299) explicitly.
 */
export function postcodeToState(postcode: string | null | undefined): AuState | null {
  if (!postcode) return null;
  const pc = postcode.trim().padStart(4, "0");
  if (!/^\d{4}$/.test(pc)) return null;
  const n = Number.parseInt(pc, 10);

  if (n >= 200 && n <= 299) return "ACT";
  if (n >= 2600 && n <= 2618) return "ACT";
  if (n >= 2900 && n <= 2920) return "ACT";
  if (n >= 800 && n <= 999) return "NT";
  if (n >= 1000 && n <= 2999) return "NSW";
  if (n >= 3000 && n <= 3999) return "VIC";
  if (n >= 8000 && n <= 8999) return "VIC";
  if (n >= 4000 && n <= 4999) return "QLD";
  if (n >= 9000 && n <= 9999) return "QLD";
  if (n >= 5000 && n <= 5999) return "SA";
  if (n >= 6000 && n <= 6999) return "WA";
  if (n >= 7000 && n <= 7999) return "TAS";
  return null;
}

/**
 * Best-effort region inference from AusPost base zone names. The data is
 * carrier-specific (Toll uses Z numbers, DHL uses zone names), so we err on
 * the side of "Regional" when nothing matches a metro pattern.
 */
export function classifyRegion(zoneLabel: string | null | undefined): RegionKind {
  if (!zoneLabel) return "Regional";
  const lower = zoneLabel.trim().toLowerCase();
  if (/(metro|metropolitan|m\d|capital)/.test(lower)) return "Metro";
  if (/(remote|outback|cape york|kimberley|n0|nq|wa-r|sa-r)/.test(lower)) return "Remote";
  return "Regional";
}

export interface PostcodeWeight {
  postcode: string;
  state: AuState;
  weight: number;
}

/**
 * For a given (carrier_code × service_code), pull the postcodes the carrier
 * actually covers, weighted by state population share. Used to spread an
 * aggregate volume row across states. Pages past the 1000-row PostgREST cap.
 */
export async function loadCarrierCoveragePostcodes(
  carrierCode: string,
  serviceCode: string
): Promise<PostcodeWeight[]> {
  const supabase = getSupabaseAdmin();
  const out: PostcodeWeight[] = [];
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("carrier_postcode_coverage")
      .select("postcode")
      .eq("carrier_code", carrierCode)
      .eq("service_code", serviceCode)
      .eq("is_covered", true)
      .order("postcode", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`loadCarrierCoveragePostcodes: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const state = postcodeToState(row.postcode as string);
      if (!state) continue;
      out.push({
        postcode: row.postcode as string,
        state,
        weight: STATE_POPULATION_SHARE[state] ?? 0,
      });
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

export interface StateDistribution {
  state: AuState;
  share: number;
  postcode_count: number;
}

/**
 * Collapses a postcode list into per-state shares. The share is the sum of
 * per-postcode population weights normalised to 1.0 across the carrier's
 * covered footprint — so a carrier that doesn't serve WA gets WA share = 0.
 */
export function distributeByState(postcodes: PostcodeWeight[]): StateDistribution[] {
  if (postcodes.length === 0) return [];
  const totals = new Map<AuState, { weight: number; count: number }>();
  for (const pc of postcodes) {
    const cur = totals.get(pc.state) ?? { weight: 0, count: 0 };
    cur.weight += pc.weight;
    cur.count += 1;
    totals.set(pc.state, cur);
  }
  const totalWeight =
    Array.from(totals.values()).reduce((s, v) => s + v.weight, 0) || 1;
  return Array.from(totals.entries())
    .map(([state, v]) => ({
      state,
      share: v.weight / totalWeight,
      postcode_count: v.count,
    }))
    .sort((a, b) => b.share - a.share);
}
