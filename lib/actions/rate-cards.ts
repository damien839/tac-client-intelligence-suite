"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  FreightRateCard,
  FreightRateCardLine,
  FreightRateCardWithDetails,
  RateBasis,
  RateCardStatus,
} from "@/lib/db/types";

export interface RateCardLineInput {
  zone_label: string;
  zone_description?: string | null;
  weight_min_kg?: number | null;
  weight_max_kg?: number | null;
  rate_basis: RateBasis;
  rate_aud: number;
  per_kg_rate_aud?: number | null;
  minimum_charge_aud?: number | null;
  notes?: string | null;
}

export interface CreateRateCardInput {
  tenant_id: string;
  carrier_id: string;
  service_level: string;
  status: RateCardStatus;
  label?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  fuel_surcharge_percent?: number | null;
  surcharges_json?: Record<string, unknown> | null;
  notes?: string | null;
  lines: RateCardLineInput[];
}

export interface UpdateRateCardInput {
  label?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  fuel_surcharge_percent?: number | null;
  surcharges_json?: Record<string, unknown> | null;
  notes?: string | null;
  status?: RateCardStatus;
  service_level?: string;
}

export interface UpdateRateCardLineInput {
  zone_label?: string;
  zone_description?: string | null;
  weight_min_kg?: number | null;
  weight_max_kg?: number | null;
  rate_basis?: RateBasis;
  rate_aud?: number;
  per_kg_rate_aud?: number | null;
  minimum_charge_aud?: number | null;
  notes?: string | null;
}

export async function listRateCards(
  tenantId: string,
  status?: RateCardStatus
): Promise<FreightRateCardWithDetails[]> {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("freight_rate_cards")
    .select(
      "*, carrier:carriers!inner(id, name, code), lines:freight_rate_card_lines(*)"
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) throw new Error(`listRateCards: ${error.message}`);
  return (data ?? []) as unknown as FreightRateCardWithDetails[];
}

export async function createRateCard(
  input: CreateRateCardInput
): Promise<FreightRateCardWithDetails> {
  if (input.lines.length === 0) {
    throw new Error("createRateCard: at least one rate line is required");
  }

  const supabase = getSupabaseAdmin();

  const { data: card, error: cardErr } = await supabase
    .from("freight_rate_cards")
    .insert({
      tenant_id: input.tenant_id,
      carrier_id: input.carrier_id,
      service_level: input.service_level.trim(),
      status: input.status,
      label: input.label?.trim() || null,
      effective_from: input.effective_from ?? null,
      effective_to: input.effective_to ?? null,
      fuel_surcharge_percent: input.fuel_surcharge_percent ?? null,
      surcharges_json: input.surcharges_json ?? null,
      notes: input.notes?.trim() || null,
    })
    .select()
    .single();

  if (cardErr) throw new Error(`createRateCard (header): ${cardErr.message}`);

  const linesPayload = input.lines.map((l) => ({
    rate_card_id: (card as FreightRateCard).id,
    zone_label: l.zone_label.trim(),
    zone_description: l.zone_description?.trim() || null,
    weight_min_kg: l.weight_min_kg ?? null,
    weight_max_kg: l.weight_max_kg ?? null,
    rate_basis: l.rate_basis,
    rate_aud: l.rate_aud,
    per_kg_rate_aud: l.per_kg_rate_aud ?? null,
    minimum_charge_aud: l.minimum_charge_aud ?? null,
    notes: l.notes?.trim() || null,
  }));

  const { error: linesErr } = await supabase
    .from("freight_rate_card_lines")
    .insert(linesPayload);

  if (linesErr) {
    // rollback the header — single-statement schema doesn't have a txn helper
    await supabase.from("freight_rate_cards").delete().eq("id", (card as FreightRateCard).id);
    throw new Error(`createRateCard (lines): ${linesErr.message}`);
  }

  revalidatePath("/final-mile");

  const { data: full, error: fullErr } = await supabase
    .from("freight_rate_cards")
    .select(
      "*, carrier:carriers!inner(id, name, code), lines:freight_rate_card_lines(*)"
    )
    .eq("id", (card as FreightRateCard).id)
    .single();
  if (fullErr) throw new Error(`createRateCard (refetch): ${fullErr.message}`);
  return full as unknown as FreightRateCardWithDetails;
}

export async function updateRateCard(
  id: string,
  patch: UpdateRateCardInput
): Promise<FreightRateCard> {
  const payload: Record<string, unknown> = {};
  if (patch.label !== undefined) payload.label = patch.label?.trim() || null;
  if (patch.effective_from !== undefined) payload.effective_from = patch.effective_from ?? null;
  if (patch.effective_to !== undefined) payload.effective_to = patch.effective_to ?? null;
  if (patch.fuel_surcharge_percent !== undefined)
    payload.fuel_surcharge_percent = patch.fuel_surcharge_percent ?? null;
  if (patch.surcharges_json !== undefined) payload.surcharges_json = patch.surcharges_json ?? null;
  if (patch.notes !== undefined) payload.notes = patch.notes?.trim() || null;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.service_level !== undefined) payload.service_level = patch.service_level.trim();

  if (Object.keys(payload).length === 0) {
    throw new Error("updateRateCard: empty patch");
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("freight_rate_cards")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(`updateRateCard: ${error.message}`);
  revalidatePath("/final-mile");
  return data as FreightRateCard;
}

export async function deleteRateCard(id: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("freight_rate_cards").delete().eq("id", id);
  if (error) throw new Error(`deleteRateCard: ${error.message}`);
  revalidatePath("/final-mile");
}

export async function addRateCardLine(
  rateCardId: string,
  line: RateCardLineInput
): Promise<FreightRateCardLine> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("freight_rate_card_lines")
    .insert({
      rate_card_id: rateCardId,
      zone_label: line.zone_label.trim(),
      zone_description: line.zone_description?.trim() || null,
      weight_min_kg: line.weight_min_kg ?? null,
      weight_max_kg: line.weight_max_kg ?? null,
      rate_basis: line.rate_basis,
      rate_aud: line.rate_aud,
      per_kg_rate_aud: line.per_kg_rate_aud ?? null,
      minimum_charge_aud: line.minimum_charge_aud ?? null,
      notes: line.notes?.trim() || null,
    })
    .select()
    .single();

  if (error) throw new Error(`addRateCardLine: ${error.message}`);
  revalidatePath("/final-mile");
  return data as FreightRateCardLine;
}

export async function updateRateCardLine(
  id: string,
  patch: UpdateRateCardLineInput
): Promise<FreightRateCardLine> {
  const payload: Record<string, unknown> = {};
  if (patch.zone_label !== undefined) payload.zone_label = patch.zone_label.trim();
  if (patch.zone_description !== undefined)
    payload.zone_description = patch.zone_description?.trim() || null;
  if (patch.weight_min_kg !== undefined) payload.weight_min_kg = patch.weight_min_kg ?? null;
  if (patch.weight_max_kg !== undefined) payload.weight_max_kg = patch.weight_max_kg ?? null;
  if (patch.rate_basis !== undefined) payload.rate_basis = patch.rate_basis;
  if (patch.rate_aud !== undefined) payload.rate_aud = patch.rate_aud;
  if (patch.per_kg_rate_aud !== undefined) payload.per_kg_rate_aud = patch.per_kg_rate_aud ?? null;
  if (patch.minimum_charge_aud !== undefined)
    payload.minimum_charge_aud = patch.minimum_charge_aud ?? null;
  if (patch.notes !== undefined) payload.notes = patch.notes?.trim() || null;

  if (Object.keys(payload).length === 0) {
    throw new Error("updateRateCardLine: empty patch");
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("freight_rate_card_lines")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(`updateRateCardLine: ${error.message}`);
  revalidatePath("/final-mile");
  return data as FreightRateCardLine;
}

export async function deleteRateCardLine(id: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("freight_rate_card_lines").delete().eq("id", id);
  if (error) throw new Error(`deleteRateCardLine: ${error.message}`);
  revalidatePath("/final-mile");
}
