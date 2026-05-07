import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { PostcodeZone } from "@/lib/db/types";

export interface PostcodeLookupResult {
  postcode: string;
  found: boolean;
  zone: PostcodeZone | null;
}

const PC_REGEX = /^\d{3,4}$/;

export function normalisePostcode(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed || !PC_REGEX.test(trimmed)) return null;
  return trimmed.padStart(4, "0");
}

export async function lookupPostcode(raw: string): Promise<PostcodeLookupResult> {
  const postcode = normalisePostcode(raw);
  if (!postcode) {
    return { postcode: String(raw), found: false, zone: null };
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("postcode_zones")
    .select("*")
    .eq("postcode", postcode)
    .maybeSingle();
  if (error) throw new Error(`lookupPostcode: ${error.message}`);
  return {
    postcode,
    found: data !== null,
    zone: (data as PostcodeZone | null) ?? null,
  };
}

export async function lookupPostcodes(rawList: string[]): Promise<PostcodeLookupResult[]> {
  const normalised = rawList.map((raw) => ({
    raw,
    pc: normalisePostcode(raw),
  }));
  const validPcs = Array.from(
    new Set(normalised.map((n) => n.pc).filter((v): v is string => v !== null))
  );

  let zoneMap: Map<string, PostcodeZone> = new Map();
  if (validPcs.length > 0) {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("postcode_zones")
      .select("*")
      .in("postcode", validPcs);
    if (error) throw new Error(`lookupPostcodes: ${error.message}`);
    zoneMap = new Map((data as PostcodeZone[]).map((z) => [z.postcode, z]));
  }

  return normalised.map(({ raw, pc }) => {
    if (!pc) return { postcode: raw, found: false, zone: null };
    const zone = zoneMap.get(pc) ?? null;
    return { postcode: pc, found: zone !== null, zone };
  });
}

const KNOWN_BASE_ZONES = ["Metro", "Capital", "Remote"] as const;

export async function postcodeZoneStats(): Promise<{
  total: number;
  by_ap_base_zone: Record<string, number>;
  source_file: string | null;
  last_imported_at: string | null;
}> {
  const supabase = getSupabaseAdmin();
  const totalRes = supabase
    .from("postcode_zones")
    .select("*", { count: "exact", head: true });
  const sampleRes = supabase
    .from("postcode_zones")
    .select("source_file, imported_at")
    .order("imported_at", { ascending: false })
    .limit(1);
  const zoneCountRes = Promise.all(
    KNOWN_BASE_ZONES.map(async (zone) => {
      const { count, error } = await supabase
        .from("postcode_zones")
        .select("*", { count: "exact", head: true })
        .eq("ap_base_zone", zone);
      if (error) throw new Error(`postcodeZoneStats (${zone}): ${error.message}`);
      return [zone, count ?? 0] as const;
    })
  );

  const [{ count: total, error: totalErr }, { data: sample, error: sampleErr }, zoneCounts] =
    await Promise.all([totalRes, sampleRes, zoneCountRes]);

  if (totalErr) throw new Error(`postcodeZoneStats (count): ${totalErr.message}`);
  if (sampleErr) throw new Error(`postcodeZoneStats (sample): ${sampleErr.message}`);

  const by_ap_base_zone: Record<string, number> = {};
  for (const [zone, count] of zoneCounts) {
    by_ap_base_zone[zone] = count;
  }
  const accounted = Object.values(by_ap_base_zone).reduce((s, n) => s + n, 0);
  const totalNum = total ?? 0;
  if (totalNum > accounted) {
    by_ap_base_zone.unknown = totalNum - accounted;
  }

  return {
    total: totalNum,
    by_ap_base_zone,
    source_file: sample?.[0]?.source_file ?? null,
    last_imported_at: sample?.[0]?.imported_at ?? null,
  };
}
