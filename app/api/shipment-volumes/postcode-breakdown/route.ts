import { NextResponse } from "next/server";
import { computePostcodeBreakdown } from "@/lib/analyzer/postcode-breakdown";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenant_id");
  if (!tenantId) {
    return NextResponse.json({ error: "tenant_id is required" }, { status: 400 });
  }

  const uploadId = url.searchParams.get("upload_id") ?? undefined;
  const carrierId = url.searchParams.get("carrier_id") ?? undefined;
  const serviceLevel = url.searchParams.get("service_level") ?? undefined;
  const minShipments = parseIntOr(url.searchParams.get("min_shipments"), 1);
  const limit = parseIntOr(url.searchParams.get("limit"), 500);

  try {
    const rows = await computePostcodeBreakdown({
      tenantId,
      uploadId,
      carrierId,
      serviceLevel,
      minShipments,
      limit,
    });
    return NextResponse.json({ rows });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function parseIntOr(v: string | null, fallback: number): number {
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
