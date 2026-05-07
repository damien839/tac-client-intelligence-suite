import { NextResponse } from "next/server";
import {
  carrierCoverageStats,
  lookupCoverageByPostcode,
  lookupCoverageForCarrier,
} from "@/lib/actions/carrier-coverage";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const stats = url.searchParams.get("stats");
    const postcode = url.searchParams.get("postcode");
    const carrier = url.searchParams.get("carrier");
    const service = url.searchParams.get("service");

    if (stats === "1") {
      const tenantId = url.searchParams.get("tenant_id");
      return NextResponse.json(
        await carrierCoverageStats(tenantId ?? undefined)
      );
    }

    if (postcode) {
      return NextResponse.json(await lookupCoverageByPostcode(postcode));
    }

    if (carrier) {
      return NextResponse.json(
        await lookupCoverageForCarrier(carrier, service ?? undefined)
      );
    }

    return NextResponse.json(
      {
        error:
          "Specify ?stats=1, ?postcode=XXXX, or ?carrier=AUSPOST[&service=STANDARD]",
      },
      { status: 400 }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
