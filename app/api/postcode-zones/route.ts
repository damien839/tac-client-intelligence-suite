import { NextResponse } from "next/server";
import {
  lookupPostcode,
  lookupPostcodes,
  postcodeZoneStats,
} from "@/lib/actions/postcode-zones";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const single = url.searchParams.get("postcode");
    const multi = url.searchParams.get("postcodes");
    const stats = url.searchParams.get("stats");

    if (stats === "1") {
      return NextResponse.json(await postcodeZoneStats());
    }

    if (single) {
      return NextResponse.json(await lookupPostcode(single));
    }

    if (multi) {
      const list = multi
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (list.length === 0) {
        return NextResponse.json({ error: "No postcodes supplied" }, { status: 400 });
      }
      if (list.length > 1000) {
        return NextResponse.json(
          { error: "Too many postcodes (max 1000 per request)" },
          { status: 400 }
        );
      }
      return NextResponse.json(await lookupPostcodes(list));
    }

    return NextResponse.json(
      {
        error:
          "Specify ?postcode=XXXX, ?postcodes=XXXX,YYYY,..., or ?stats=1",
      },
      { status: 400 }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
