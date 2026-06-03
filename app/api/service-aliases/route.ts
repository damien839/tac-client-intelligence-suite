import { NextResponse } from "next/server";
import {
  createServiceAlias,
  listServiceAliases,
  type CreateAliasInput,
} from "@/lib/actions/service-aliases";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenant_id");
    const aliases = await listServiceAliases(tenantId);
    return NextResponse.json(aliases);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CreateAliasInput;
    if (!body.carrier_id || !body.raw_label || !body.canonical_tier) {
      return NextResponse.json(
        { error: "carrier_id, raw_label, canonical_tier are required" },
        { status: 400 }
      );
    }
    const created = await createServiceAlias({
      carrier_id: body.carrier_id,
      tenant_id: body.tenant_id ?? null,
      raw_label: body.raw_label,
      canonical_tier: body.canonical_tier,
      notes: body.notes ?? null,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
