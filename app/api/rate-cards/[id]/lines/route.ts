import { NextResponse } from "next/server";
import { addRateCardLine } from "@/lib/actions/rate-cards";

export const runtime = "nodejs";

interface RouteContext {
  params: { id: string };
}

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const body = await req.json();
    const created = await addRateCardLine(params.id, body);
    return NextResponse.json(created, { status: 201 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
