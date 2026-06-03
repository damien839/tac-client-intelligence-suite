import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  Tenant,
  FreightShipmentVolumeWithCarrier,
  FreightRateCard,
  FreightRateCardLine,
  Carrier,
} from "@/lib/db/types";

export interface RateCardWithLines extends FreightRateCard {
  carrier: Pick<Carrier, "id" | "name" | "code">;
  lines: FreightRateCardLine[];
}

export interface AnalyzerSnapshot {
  tenant: Tenant;
  volumes: FreightShipmentVolumeWithCarrier[];
  current_rate_cards: RateCardWithLines[];
  new_rate_cards: RateCardWithLines[];
  generated_at: string;
}

/**
 * Build the canonical input snapshot for both chat mode and report mode.
 * Always tenant-scoped — never crosses tenants.
 */
export async function buildAnalyzerSnapshot(tenantId: string): Promise<AnalyzerSnapshot> {
  const supabase = getSupabaseAdmin();

  // Read from the unified view so we get manual_csv summary rows AND
  // aggregated billing-extract lines in one shape. See migration
  // 00010_shipment_volumes_unified.sql. Views don't expose FK relationships
  // to PostgREST, so we fetch carriers separately and merge in JS rather
  // than using a `carrier:carriers!inner(...)` embed.
  const [tenantRes, volumesRes, currentCardsRes, newCardsRes, carriersRes] =
    await Promise.all([
      supabase.from("tenants").select("*").eq("id", tenantId).maybeSingle(),
      supabase
        .from("shipment_volumes_unified")
        .select("*")
        .eq("tenant_id", tenantId),
      supabase
        .from("freight_rate_cards")
        .select(
          "*, carrier:carriers!inner(id, name, code), lines:freight_rate_card_lines(*)"
        )
        .eq("tenant_id", tenantId)
        .eq("status", "current"),
      supabase
        .from("freight_rate_cards")
        .select(
          "*, carrier:carriers!inner(id, name, code), lines:freight_rate_card_lines(*)"
        )
        .eq("tenant_id", tenantId)
        .eq("status", "new"),
      supabase.from("carriers").select("id, name, code"),
    ]);

  if (tenantRes.error) throw new Error(`snapshot: tenant load failed — ${tenantRes.error.message}`);
  if (!tenantRes.data) throw new Error(`snapshot: tenant ${tenantId} not found`);
  if (volumesRes.error) throw new Error(`snapshot: volumes — ${volumesRes.error.message}`);
  if (currentCardsRes.error) throw new Error(`snapshot: current cards — ${currentCardsRes.error.message}`);
  if (newCardsRes.error) throw new Error(`snapshot: new cards — ${newCardsRes.error.message}`);
  if (carriersRes.error) throw new Error(`snapshot: carriers — ${carriersRes.error.message}`);

  const carrierById = new Map(
    (carriersRes.data ?? []).map((c) => [c.id, c as Pick<Carrier, "id" | "name" | "code">])
  );
  const volumes = (volumesRes.data ?? []).map((v) => ({
    ...(v as Record<string, unknown>),
    carrier: carrierById.get((v as { carrier_id: string }).carrier_id) ?? null,
  })) as unknown as FreightShipmentVolumeWithCarrier[];

  return {
    tenant: tenantRes.data as Tenant,
    volumes,
    current_rate_cards: (currentCardsRes.data ?? []) as unknown as RateCardWithLines[],
    new_rate_cards: (newCardsRes.data ?? []) as unknown as RateCardWithLines[],
    generated_at: new Date().toISOString(),
  };
}

/**
 * Lightweight summary of the snapshot — used to decide if the analyzer
 * has enough data to do anything useful and to pre-fill the chat hint.
 */
export function summariseSnapshot(snap: AnalyzerSnapshot) {
  const totalShipments = snap.volumes.reduce(
    (sum, v) => sum + Number(v.monthly_shipments || 0),
    0
  );
  const totalSpend = snap.volumes.reduce(
    (sum, v) => sum + Number(v.monthly_shipments || 0) * Number(v.avg_charge_aud || 0),
    0
  );
  const carrierMix = Array.from(
    new Set(snap.volumes.map((v) => v.carrier?.name).filter(Boolean))
  );
  return {
    total_monthly_shipments: totalShipments,
    total_monthly_spend: totalSpend,
    carrier_count: carrierMix.length,
    carriers: carrierMix,
    volume_row_count: snap.volumes.length,
    current_card_count: snap.current_rate_cards.length,
    new_card_count: snap.new_rate_cards.length,
  };
}
