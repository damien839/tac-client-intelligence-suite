import { NextResponse } from "next/server";
import { listUnmappedLabels } from "@/lib/actions/service-aliases";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenant_id");
    const unmapped = await listUnmappedLabels(tenantId);
    return NextResponse.json(unmapped);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
