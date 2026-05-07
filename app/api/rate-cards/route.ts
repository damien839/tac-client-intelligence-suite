import { NextResponse } from "next/server";
import { createRateCard, listRateCards } from "@/lib/actions/rate-cards";
import type { RateCardStatus } from "@/lib/db/types";

export const runtime = "nodejs";

const VALID_STATUSES: RateCardStatus[] = ["current", "new", "archived"];

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantId = url.searchParams.get("tenant_id");
    const statusParam = url.searchParams.get("status");

    if (!tenantId) {
      return NextResponse.json({ error: "tenant_id is required" }, { status: 400 });
    }
    let status: RateCardStatus | undefined;
    if (statusParam) {
      if (!VALID_STATUSES.includes(statusParam as RateCardStatus)) {
        return NextResponse.json({ error: "invalid status" }, { status: 400 });
      }
      status = statusParam as RateCardStatus;
    }

    const cards = await listRateCards(tenantId, status);
    return NextResponse.json(cards);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.tenant_id || !body.carrier_id || !body.service_level || !body.status) {
      return NextResponse.json(
        { error: "tenant_id, carrier_id, service_level, status are required" },
        { status: 400 }
      );
    }
    if (!VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json({ error: "at least one line is required" }, { status: 400 });
    }

    const created = await createRateCard(body);
    return NextResponse.json(created, { status: 201 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
