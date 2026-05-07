import { NextResponse } from "next/server";
import { listTenants, createTenant } from "@/lib/actions/tenants";

export async function GET() {
  try {
    const tenants = await listTenants();
    return NextResponse.json(tenants);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const tenant = await createTenant({
      name: body.name,
      kind: body.kind ?? "prospect",
      industry: body.industry,
      currency: body.currency,
      notes: body.notes,
    });
    return NextResponse.json(tenant, { status: 201 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
