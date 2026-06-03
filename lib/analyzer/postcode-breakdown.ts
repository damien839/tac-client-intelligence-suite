import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Per-postcode cost summary derived from shipment_lines. This is what
 * the drill-down UI consumes to answer "which postcodes drive the
 * cost gap" and to show the top contributors per carrier.
 *
 * Computed on-demand from raw lines; no caching. At ~50k lines and
 * ~3.5k unique postcodes per tenant, the GROUP BY is sub-100ms in
 * Postgres. Re-evaluate if line counts grow past a few million.
 */

export interface PostcodeBreakdownRow {
  postcode: string;
  resolved_zone: string;
  carrier_id: string;
  carrier_name: string | null;
  carrier_code: string | null;
  service_level: string | null;
  shipments: number;
  total_charge_aud: number;
  avg_charge_aud: number;
  avg_weight_kg: number | null;
}

export interface PostcodeBreakdownOptions {
  tenantId: string;
  uploadId?: string;        // restrict to a single upload
  carrierId?: string;       // restrict to one carrier
  serviceLevel?: string;    // restrict to one service tier
  minShipments?: number;    // hide postcodes with < N shipments (default 1)
  limit?: number;           // top-N by spend (default 500)
}

interface RawLine {
  postcode: string;
  resolved_zone: string | null;
  carrier_id: string;
  service_level: string | null;
  charge_aud: number | string;
  weight_kg: number | string | null;
}

interface CarrierMeta {
  id: string;
  name: string;
  code: string;
}

/**
 * Pull lines (paginated via .range to bypass the 1000-row PostgREST cap)
 * and aggregate in JS. Postgres GROUP BY would be faster but PostgREST
 * doesn't expose aggregate SQL without an RPC — and the dataset is
 * small enough that this is fine for now. Move to an RPC if it gets slow.
 */
export async function computePostcodeBreakdown(
  opts: PostcodeBreakdownOptions
): Promise<PostcodeBreakdownRow[]> {
  const supabase = getSupabaseAdmin();
  const minShipments = opts.minShipments ?? 1;
  const limit = opts.limit ?? 500;

  let query = supabase
    .from("shipment_lines")
    .select(
      "postcode, resolved_zone, carrier_id, service_level, charge_aud, weight_kg"
    )
    .eq("tenant_id", opts.tenantId);

  if (opts.uploadId) query = query.eq("upload_id", opts.uploadId);
  if (opts.carrierId) query = query.eq("carrier_id", opts.carrierId);
  if (opts.serviceLevel) query = query.eq("service_level", opts.serviceLevel);

  const lines: RawLine[] = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw new Error(`postcode breakdown load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    lines.push(...(data as RawLine[]));
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  if (lines.length === 0) return [];

  const carrierIds = Array.from(new Set(lines.map((l) => l.carrier_id)));
  const { data: carrierRows, error: cErr } = await supabase
    .from("carriers")
    .select("id, name, code")
    .in("id", carrierIds);
  if (cErr) throw new Error(`carrier metadata load failed: ${cErr.message}`);
  const carriers = new Map<string, CarrierMeta>();
  for (const c of (carrierRows ?? []) as CarrierMeta[]) carriers.set(c.id, c);

  const acc = new Map<
    string,
    {
      postcode: string;
      resolved_zone: string;
      carrier_id: string;
      service_level: string | null;
      shipments: number;
      total_charge: number;
      weight_sum: number;
      weight_n: number;
    }
  >();

  for (const l of lines) {
    const charge = Number(l.charge_aud);
    if (!Number.isFinite(charge)) continue;
    const key = `${l.postcode}::${l.carrier_id}::${l.service_level ?? ""}`;
    const cur = acc.get(key) ?? {
      postcode: l.postcode,
      resolved_zone: l.resolved_zone ?? "Unknown",
      carrier_id: l.carrier_id,
      service_level: l.service_level,
      shipments: 0,
      total_charge: 0,
      weight_sum: 0,
      weight_n: 0,
    };
    cur.shipments += 1;
    cur.total_charge += charge;
    if (l.weight_kg != null) {
      const w = Number(l.weight_kg);
      if (Number.isFinite(w)) {
        cur.weight_sum += w;
        cur.weight_n += 1;
      }
    }
    acc.set(key, cur);
  }

  const rows: PostcodeBreakdownRow[] = [];
  for (const a of Array.from(acc.values())) {
    if (a.shipments < minShipments) continue;
    const carrier = carriers.get(a.carrier_id);
    rows.push({
      postcode: a.postcode,
      resolved_zone: a.resolved_zone,
      carrier_id: a.carrier_id,
      carrier_name: carrier?.name ?? null,
      carrier_code: carrier?.code ?? null,
      service_level: a.service_level,
      shipments: a.shipments,
      total_charge_aud: round2(a.total_charge),
      avg_charge_aud: round2(a.total_charge / a.shipments),
      avg_weight_kg: a.weight_n > 0 ? round3(a.weight_sum / a.weight_n) : null,
    });
  }

  rows.sort((a, b) => b.total_charge_aud - a.total_charge_aud);
  return rows.slice(0, limit);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
