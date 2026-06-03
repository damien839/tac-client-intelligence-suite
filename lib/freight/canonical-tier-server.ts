import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  isCanonicalServiceLevel,
  type ServiceLevel,
} from "@/lib/constants/service-levels";
import { matchCanonicalCaseInsensitive } from "@/lib/freight/canonical-tier";

export interface AliasRow {
  id: string;
  carrier_id: string;
  tenant_id: string | null;
  raw_label: string;
  canonical_tier: ServiceLevel;
  notes: string | null;
}

interface ResolveArgs {
  carrierId: string;
  tenantId: string;
  rawLabel: string | null | undefined;
}

export async function resolveCanonicalTier(
  args: ResolveArgs
): Promise<ServiceLevel | null> {
  const label = (args.rawLabel ?? "").trim();
  if (label.length === 0) return null;

  const exact = matchCanonicalCaseInsensitive(label);
  if (exact) return exact;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("carrier_service_aliases")
    .select("tenant_id, canonical_tier")
    .eq("carrier_id", args.carrierId)
    .ilike("raw_label", label)
    .or(`tenant_id.eq.${args.tenantId},tenant_id.is.null`);

  if (error) {
    throw new Error(`resolveCanonicalTier: ${error.message}`);
  }
  if (!data || data.length === 0) return null;

  const tenantRow = data.find((r) => r.tenant_id === args.tenantId);
  const chosen = tenantRow ?? data.find((r) => r.tenant_id === null) ?? null;
  if (!chosen) return null;
  return isCanonicalServiceLevel(chosen.canonical_tier)
    ? (chosen.canonical_tier as ServiceLevel)
    : null;
}

interface BatchResolveArgs {
  carrierId: string;
  tenantId: string;
  rawLabels: ReadonlyArray<string | null | undefined>;
}

export async function resolveCanonicalTiers(
  args: BatchResolveArgs
): Promise<Map<string, ServiceLevel>> {
  const out = new Map<string, ServiceLevel>();
  const labels = new Set<string>();
  for (const raw of args.rawLabels) {
    const trimmed = (raw ?? "").trim();
    if (trimmed.length === 0) continue;
    const exact = matchCanonicalCaseInsensitive(trimmed);
    if (exact) {
      out.set(trimmed.toLowerCase(), exact);
    } else {
      labels.add(trimmed.toLowerCase());
    }
  }
  if (labels.size === 0) return out;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("carrier_service_aliases")
    .select("tenant_id, raw_label, canonical_tier")
    .eq("carrier_id", args.carrierId)
    .or(`tenant_id.eq.${args.tenantId},tenant_id.is.null`);

  if (error) {
    throw new Error(`resolveCanonicalTiers: ${error.message}`);
  }

  const ordered = [...(data ?? [])].sort((a, b) => {
    if (a.tenant_id === null && b.tenant_id !== null) return -1;
    if (a.tenant_id !== null && b.tenant_id === null) return 1;
    return 0;
  });
  for (const row of ordered) {
    const key = row.raw_label.trim().toLowerCase();
    if (!labels.has(key)) continue;
    if (!isCanonicalServiceLevel(row.canonical_tier)) continue;
    out.set(key, row.canonical_tier as ServiceLevel);
  }
  return out;
}

export function lookupCanonicalTier(
  resolved: Map<string, ServiceLevel>,
  rawLabel: string | null | undefined
): ServiceLevel | null {
  const trimmed = (rawLabel ?? "").trim();
  if (trimmed.length === 0) return null;
  return resolved.get(trimmed.toLowerCase()) ?? null;
}
