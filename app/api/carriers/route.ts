import { NextResponse } from "next/server";
import { listCarriers } from "@/lib/actions/carriers";

export async function GET() {
  try {
    const carriers = await listCarriers();
    return NextResponse.json(carriers);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
