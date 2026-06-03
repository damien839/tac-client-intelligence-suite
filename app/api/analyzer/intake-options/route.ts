import { NextResponse } from "next/server";

import { buildAnalyzerSnapshot } from "@/lib/analyzer/snapshot";

export const runtime = "nodejs";

interface CarrierLite {
  code: string;
  name: string;
  monthly_shipments: number;
}

interface ServiceTierPairLite {
  volume_carrier_code: string;
  volume_carrier_name: string;
  volume_service_level: string;
  monthly_shipments: number;
  monthly_spend_aud: number;
}

interface RateCardLite {
  id: string;
  carrier_code: string;
  carrier_name: string;
  service_level: string;
  label: string | null;
  effective_from: string | null;
  fuel_surcharge_percent: number | null;
}

interface IntakeOptionsResponse {
  default_period_label: string | null;
  carriers_in_volumes: CarrierLite[];
  service_tier_pairs: ServiceTierPairLite[];
  new_rate_cards: RateCardLite[];
  total_monthly_shipments: number;
  total_monthly_spend_aud: number;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get("tenant_id");
  if (!tenantId) {
    return NextResponse.json({ error: "tenant_id query param required" }, { status: 400 });
  }

  try {
    const snapshot = await buildAnalyzerSnapshot(tenantId);

    const carrierTotals = new Map<string, CarrierLite>();
    const pairs = new Map<string, ServiceTierPairLite>();
    let totalShipments = 0;
    let totalSpend = 0;

    for (const v of snapshot.volumes) {
      const code = v.carrier?.code;
      const name = v.carrier?.name ?? code ?? "Unknown";
      if (!code) continue;
      const shipments = Number(v.monthly_shipments || 0);
      const charge = Number(v.avg_charge_aud || 0);
      totalShipments += shipments;
      totalSpend += shipments * charge;

      const existingCarrier = carrierTotals.get(code);
      if (existingCarrier) {
        existingCarrier.monthly_shipments += shipments;
      } else {
        carrierTotals.set(code, { code, name, monthly_shipments: shipments });
      }

      const tier = (v.service_level || "").trim() || "(unspecified)";
      const pairKey = `${code}::${tier}`;
      const existingPair = pairs.get(pairKey);
      if (existingPair) {
        existingPair.monthly_shipments += shipments;
        existingPair.monthly_spend_aud += shipments * charge;
      } else {
        pairs.set(pairKey, {
          volume_carrier_code: code,
          volume_carrier_name: name,
          volume_service_level: tier,
          monthly_shipments: shipments,
          monthly_spend_aud: shipments * charge,
        });
      }
    }

    const newRateCards: RateCardLite[] = snapshot.new_rate_cards.map((c) => ({
      id: c.id,
      carrier_code: c.carrier?.code ?? "",
      carrier_name: c.carrier?.name ?? c.carrier?.code ?? "",
      service_level: c.service_level,
      label: c.label,
      effective_from: c.effective_from,
      fuel_surcharge_percent:
        c.fuel_surcharge_percent != null ? Number(c.fuel_surcharge_percent) : null,
    }));

    const response: IntakeOptionsResponse = {
      default_period_label: snapshot.volumes[0]?.period_label ?? null,
      carriers_in_volumes: Array.from(carrierTotals.values()).sort(
        (a, b) => b.monthly_shipments - a.monthly_shipments
      ),
      service_tier_pairs: Array.from(pairs.values()).sort(
        (a, b) => b.monthly_shipments - a.monthly_shipments
      ),
      new_rate_cards: newRateCards.sort((a, b) =>
        `${a.carrier_name}|${a.service_level}`.localeCompare(`${b.carrier_name}|${b.service_level}`)
      ),
      total_monthly_shipments: totalShipments,
      total_monthly_spend_aud: totalSpend,
    };

    return NextResponse.json(response);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
