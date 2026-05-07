"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  FreightShipmentVolume,
  FreightShipmentVolumeWithCarrier,
  VolumeSource,
} from "@/lib/db/types";

export interface ShipmentVolumeInput {
  tenant_id: string;
  carrier_id: string;
  service_level: string;
  zone_label: string;
  monthly_shipments: number;
  avg_charge_aud: number;
  avg_weight_kg?: number | null;
  period_label?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  source?: VolumeSource;
  source_upload_id?: string | null;
  notes?: string | null;
}

export async function listShipmentVolumes(
  tenantId: string
): Promise<FreightShipmentVolumeWithCarrier[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("freight_shipment_volumes")
    .select("*, carrier:carriers!inner(id, name, code)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listShipmentVolumes: ${error.message}`);
  return (data ?? []) as unknown as FreightShipmentVolumeWithCarrier[];
}

export async function createShipmentVolumes(
  rows: ShipmentVolumeInput[]
): Promise<FreightShipmentVolume[]> {
  if (rows.length === 0) return [];

  const supabase = getSupabaseAdmin();
  const payload = rows.map((r) => ({
    tenant_id: r.tenant_id,
    carrier_id: r.carrier_id,
    service_level: r.service_level.trim(),
    zone_label: r.zone_label.trim(),
    monthly_shipments: r.monthly_shipments,
    avg_charge_aud: r.avg_charge_aud,
    avg_weight_kg: r.avg_weight_kg ?? null,
    period_label: r.period_label?.trim() || null,
    period_start: r.period_start ?? null,
    period_end: r.period_end ?? null,
    source: r.source ?? "manual_csv",
    source_upload_id: r.source_upload_id ?? null,
    notes: r.notes?.trim() || null,
  }));

  const { data, error } = await supabase
    .from("freight_shipment_volumes")
    .insert(payload)
    .select();

  if (error) throw new Error(`createShipmentVolumes: ${error.message}`);
  revalidatePath("/final-mile");
  return (data ?? []) as FreightShipmentVolume[];
}

export async function deleteShipmentVolume(id: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("freight_shipment_volumes")
    .delete()
    .eq("id", id);

  if (error) throw new Error(`deleteShipmentVolume: ${error.message}`);
  revalidatePath("/final-mile");
}

export async function deleteShipmentVolumesForTenant(
  tenantId: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("freight_shipment_volumes")
    .delete()
    .eq("tenant_id", tenantId);

  if (error) throw new Error(`deleteShipmentVolumesForTenant: ${error.message}`);
  revalidatePath("/final-mile");
}
