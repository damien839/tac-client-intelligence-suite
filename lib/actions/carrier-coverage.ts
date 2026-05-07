import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  CarrierCoverage,
  PostcodeCoverageBundle,
  PostcodeZone,
} from "@/lib/db/types";
import { lookupPostcode, normalisePostcode } from "@/lib/actions/postcode-zones";

export async function lookupCoverageByPostcode(
  raw: string
): Promise<PostcodeCoverageBundle> {
  const postcode = normalisePostcode(raw);
  if (!postcode) {
    return { postcode: String(raw), zone: null, carriers: [] };
  }
  const [zoneRes, coverageRes] = await Promise.all([
    lookupPostcode(postcode),
    fetchCoverageRowsForPostcode(postcode),
  ]);
  return {
    postcode,
    zone: zoneRes.zone,
    carriers: coverageRes,
  };
}

export async function lookupCoverageForCarrier(
  carrierCode: string,
  serviceCode?: string
): Promise<CarrierCoverage[]> {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("carrier_postcode_coverage")
    .select("*")
    .eq("carrier_code", carrierCode);
  if (serviceCode) {
    query = query.eq("service_code", serviceCode);
  }
  const { data, error } = await query.order("postcode", { ascending: true });
  if (error) throw new Error(`lookupCoverageForCarrier: ${error.message}`);
  return (data as CarrierCoverage[]) ?? [];
}

export interface CoverageStats {
  total_rows: number;
  by_carrier: Array<{
    carrier_code: string;
    service_code: string;
    postcode_count: number;
  }>;
  source: string | null;
  last_imported_at: string | null;
  missing_for_tenant: Array<{
    carrier_id: string;
    carrier_code: string;
    carrier_name: string;
  }>;
}

export async function carrierCoverageStats(
  tenantId?: string
): Promise<CoverageStats> {
  const supabase = getSupabaseAdmin();

  const totalRes = supabase
    .from("carrier_postcode_coverage")
    .select("*", { count: "exact", head: true });

  const sampleRes = supabase
    .from("carrier_postcode_coverage")
    .select("source, imported_at")
    .order("imported_at", { ascending: false })
    .limit(1);

  const pairsRes = fetchCarrierServicePairs(supabase);

  const [totalRow, sampleRow, pairs] = await Promise.all([
    totalRes,
    sampleRes,
    pairsRes,
  ]);

  if (totalRow.error)
    throw new Error(`carrierCoverageStats (count): ${totalRow.error.message}`);
  if (sampleRow.error)
    throw new Error(`carrierCoverageStats (sample): ${sampleRow.error.message}`);

  const counts = await Promise.all(
    pairs.map(async (pair) => {
      const { count, error } = await supabase
        .from("carrier_postcode_coverage")
        .select("*", { count: "exact", head: true })
        .eq("carrier_code", pair.carrier_code)
        .eq("service_code", pair.service_code);
      if (error)
        throw new Error(
          `carrierCoverageStats (${pair.carrier_code}/${pair.service_code}): ${error.message}`
        );
      return {
        carrier_code: pair.carrier_code,
        service_code: pair.service_code,
        postcode_count: count ?? 0,
      };
    })
  );

  const coveredCarrierCodes = new Set(pairs.map((p) => p.carrier_code));
  const missing = tenantId
    ? await fetchMissingCoverageCarriersForTenant(
        supabase,
        tenantId,
        coveredCarrierCodes
      )
    : [];

  return {
    total_rows: totalRow.count ?? 0,
    by_carrier: counts.sort((a, b) => b.postcode_count - a.postcode_count),
    source: sampleRow.data?.[0]?.source ?? null,
    last_imported_at: sampleRow.data?.[0]?.imported_at ?? null,
    missing_for_tenant: missing,
  };
}

async function fetchMissingCoverageCarriersForTenant(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  tenantId: string,
  coveredCarrierCodes: ReadonlySet<string>
): Promise<CoverageStats["missing_for_tenant"]> {
  const { data, error } = await supabase
    .from("freight_rate_cards")
    .select("carrier_id, carrier:carriers(id, name, code)")
    .eq("tenant_id", tenantId);
  if (error)
    throw new Error(
      `fetchMissingCoverageCarriersForTenant: ${error.message}`
    );

  type Row = {
    carrier_id: string;
    carrier:
      | { id: string; name: string; code: string }
      | { id: string; name: string; code: string }[]
      | null;
  };
  const seen = new Set<string>();
  const missing: CoverageStats["missing_for_tenant"] = [];
  for (const row of (data ?? []) as Row[]) {
    const carrier = Array.isArray(row.carrier) ? row.carrier[0] : row.carrier;
    if (!carrier) continue;
    if (coveredCarrierCodes.has(carrier.code)) continue;
    if (seen.has(carrier.id)) continue;
    seen.add(carrier.id);
    missing.push({
      carrier_id: carrier.id,
      carrier_code: carrier.code,
      carrier_name: carrier.name,
    });
  }
  missing.sort((a, b) => a.carrier_name.localeCompare(b.carrier_name));
  return missing;
}

async function fetchCoverageRowsForPostcode(
  postcode: string
): Promise<CarrierCoverage[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("carrier_postcode_coverage")
    .select("*")
    .eq("postcode", postcode)
    .order("carrier_code", { ascending: true });
  if (error)
    throw new Error(`lookupCoverageByPostcode: ${error.message}`);
  return (data as CarrierCoverage[]) ?? [];
}

async function fetchCarrierServicePairs(
  supabase: ReturnType<typeof getSupabaseAdmin>
): Promise<Array<{ carrier_code: string; service_code: string }>> {
  const seen = new Set<string>();
  const out: Array<{ carrier_code: string; service_code: string }> = [];
  let from = 0;
  const PAGE = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from("carrier_postcode_coverage")
      .select("carrier_code, service_code")
      .order("carrier_code", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error)
      throw new Error(`fetchCarrierServicePairs: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const key = `${row.carrier_code}|${row.service_code}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          carrier_code: row.carrier_code,
          service_code: row.service_code,
        });
      }
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

export type ZoneSummary = Pick<
  PostcodeZone,
  "postcode" | "ap_base_zone" | "ap_zone_z40" | "toll_zone" | "dhl_zone_name"
>;
