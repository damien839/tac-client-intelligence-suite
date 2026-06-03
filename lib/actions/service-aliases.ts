"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  SERVICE_LEVEL_OPTIONS,
  isCanonicalServiceLevel,
} from "@/lib/constants/service-levels";
import type {
  CarrierServiceAlias,
  CarrierServiceAliasWithCarrier,
} from "@/lib/db/types";

export interface CreateAliasInput {
  carrier_id: string;
  tenant_id: string | null;
  raw_label: string;
  canonical_tier: string;
  notes?: string | null;
}

export interface UpdateAliasInput {
  canonical_tier?: string;
  notes?: string | null;
}

export interface UnmappedLabel {
  carrier_id: string;
  carrier_code: string;
  carrier_name: string;
  raw_label: string;
  occurrence_count: number;
  source: "manual_csv" | "billing_extract";
}

function assertCanonical(tier: string): void {
  if (!isCanonicalServiceLevel(tier)) {
    throw new Error(
      `canonical_tier must be one of: ${SERVICE_LEVEL_OPTIONS.join(", ")}`
    );
  }
}

export async function listServiceAliases(
  tenantId: string | null
): Promise<CarrierServiceAliasWithCarrier[]> {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("carrier_service_aliases")
    .select("*, carrier:carriers!inner(id, name, code)")
    .order("created_at", { ascending: false });
  if (tenantId === null) {
    query = query.is("tenant_id", null);
  } else {
    query = query.or(`tenant_id.eq.${tenantId},tenant_id.is.null`);
  }
  const { data, error } = await query;
  if (error) throw new Error(`listServiceAliases: ${error.message}`);
  return (data ?? []) as unknown as CarrierServiceAliasWithCarrier[];
}

export async function createServiceAlias(
  input: CreateAliasInput
): Promise<CarrierServiceAlias> {
  const trimmed = input.raw_label.trim();
  if (trimmed.length === 0) throw new Error("raw_label is required");
  assertCanonical(input.canonical_tier);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("carrier_service_aliases")
    .insert({
      carrier_id: input.carrier_id,
      tenant_id: input.tenant_id,
      raw_label: trimmed,
      canonical_tier: input.canonical_tier,
      notes: input.notes?.trim() || null,
    })
    .select()
    .single();
  if (error) throw new Error(`createServiceAlias: ${error.message}`);

  await backfillCanonicalForAlias({
    carrierId: input.carrier_id,
    tenantId: input.tenant_id,
    rawLabel: trimmed,
    canonicalTier: input.canonical_tier,
  });

  revalidatePath("/final-mile/admin/service-mapping");
  revalidatePath("/final-mile/analyzer");
  return data as CarrierServiceAlias;
}

export async function updateServiceAlias(
  id: string,
  input: UpdateAliasInput
): Promise<CarrierServiceAlias> {
  if (input.canonical_tier !== undefined) assertCanonical(input.canonical_tier);

  const supabase = getSupabaseAdmin();
  const patch: Record<string, unknown> = {};
  if (input.canonical_tier !== undefined) patch.canonical_tier = input.canonical_tier;
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;

  const { data, error } = await supabase
    .from("carrier_service_aliases")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`updateServiceAlias: ${error.message}`);

  // Re-resolve any volume/line rows that pointed at this alias's raw_label.
  if (input.canonical_tier !== undefined) {
    await backfillCanonicalForAlias({
      carrierId: data.carrier_id,
      tenantId: data.tenant_id,
      rawLabel: data.raw_label,
      canonicalTier: input.canonical_tier,
    });
  }

  revalidatePath("/final-mile/admin/service-mapping");
  revalidatePath("/final-mile/analyzer");
  return data as CarrierServiceAlias;
}

export async function deleteServiceAlias(id: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("carrier_service_aliases")
    .delete()
    .eq("id", id);
  if (error) throw new Error(`deleteServiceAlias: ${error.message}`);
  revalidatePath("/final-mile/admin/service-mapping");
  revalidatePath("/final-mile/analyzer");
}

/**
 * Find every (carrier, raw_label) appearing in volume / line data that does
 * NOT have a resolved canonical_tier. These are the rows the admin UI shows
 * as "needs mapping."
 *
 * tenantId scopes the search; pass null to inspect global data.
 */
export async function listUnmappedLabels(
  tenantId: string | null
): Promise<UnmappedLabel[]> {
  const supabase = getSupabaseAdmin();
  const carrierMap = await loadCarrierLookup();

  const out = new Map<string, UnmappedLabel>();

  // Manual CSV rows.
  let volQuery = supabase
    .from("freight_shipment_volumes")
    .select("carrier_id, service_level")
    .is("canonical_tier", null);
  if (tenantId) volQuery = volQuery.eq("tenant_id", tenantId);
  const { data: volRows, error: volErr } = await volQuery;
  if (volErr) throw new Error(`listUnmappedLabels (volumes): ${volErr.message}`);
  for (const r of volRows ?? []) {
    accumulate(out, carrierMap, r.carrier_id, r.service_level, "manual_csv");
  }

  // Billing-extract lines. Page through to dodge PostgREST's 1000-row cap.
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    let lineQuery = supabase
      .from("shipment_lines")
      .select("carrier_id, service_level")
      .is("canonical_tier", null)
      .range(offset, offset + pageSize - 1);
    if (tenantId) lineQuery = lineQuery.eq("tenant_id", tenantId);
    const { data: lineRows, error: lineErr } = await lineQuery;
    if (lineErr) throw new Error(`listUnmappedLabels (lines): ${lineErr.message}`);
    if (!lineRows || lineRows.length === 0) break;
    for (const r of lineRows) {
      accumulate(out, carrierMap, r.carrier_id, r.service_level, "billing_extract");
    }
    if (lineRows.length < pageSize) break;
    offset += lineRows.length;
  }

  return Array.from(out.values()).sort(
    (a, b) =>
      a.carrier_name.localeCompare(b.carrier_name) ||
      b.occurrence_count - a.occurrence_count
  );
}

interface BackfillArgs {
  carrierId: string;
  tenantId: string | null;
  rawLabel: string;
  canonicalTier: string;
}

/**
 * Update every volume + line row whose service_level matches the alias's
 * raw_label (case-insensitive) and whose canonical_tier is currently null,
 * so a newly-added alias takes effect immediately without a re-import.
 *
 * Tenant override: only touch rows for that tenant. Global alias: touch all
 * tenants but skip rows already pinned by a tenant override (we approximate
 * that as "row already has a non-null canonical_tier").
 */
async function backfillCanonicalForAlias(args: BackfillArgs): Promise<void> {
  const supabase = getSupabaseAdmin();

  let volQuery = supabase
    .from("freight_shipment_volumes")
    .update({ canonical_tier: args.canonicalTier })
    .eq("carrier_id", args.carrierId)
    .ilike("service_level", args.rawLabel)
    .is("canonical_tier", null);
  if (args.tenantId) volQuery = volQuery.eq("tenant_id", args.tenantId);
  const { error: volErr } = await volQuery;
  if (volErr) throw new Error(`backfillCanonicalForAlias volumes: ${volErr.message}`);

  let lineQuery = supabase
    .from("shipment_lines")
    .update({ canonical_tier: args.canonicalTier })
    .eq("carrier_id", args.carrierId)
    .ilike("service_level", args.rawLabel)
    .is("canonical_tier", null);
  if (args.tenantId) lineQuery = lineQuery.eq("tenant_id", args.tenantId);
  const { error: lineErr } = await lineQuery;
  if (lineErr) throw new Error(`backfillCanonicalForAlias lines: ${lineErr.message}`);
}

async function loadCarrierLookup(): Promise<
  Map<string, { code: string; name: string }>
> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("carriers").select("id, name, code");
  if (error) throw new Error(`loadCarrierLookup: ${error.message}`);
  return new Map((data ?? []).map((c) => [c.id, { code: c.code, name: c.name }]));
}

function accumulate(
  out: Map<string, UnmappedLabel>,
  carrierMap: Map<string, { code: string; name: string }>,
  carrierId: string,
  rawLabel: string | null,
  source: UnmappedLabel["source"]
): void {
  const label = (rawLabel ?? "").trim();
  if (label.length === 0) return;
  const carrier = carrierMap.get(carrierId);
  if (!carrier) return;
  const key = `${carrierId}|${label.toLowerCase()}|${source}`;
  const existing = out.get(key);
  if (existing) {
    existing.occurrence_count += 1;
    return;
  }
  out.set(key, {
    carrier_id: carrierId,
    carrier_code: carrier.code,
    carrier_name: carrier.name,
    raw_label: label,
    occurrence_count: 1,
    source,
  });
}
