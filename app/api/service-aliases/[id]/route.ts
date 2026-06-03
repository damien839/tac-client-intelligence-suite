import { NextResponse } from "next/server";
import {
  deleteServiceAlias,
  updateServiceAlias,
  type UpdateAliasInput,
} from "@/lib/actions/service-aliases";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = (await req.json()) as UpdateAliasInput;
    const updated = await updateServiceAlias(params.id, body);
    return NextResponse.json(updated);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    await deleteServiceAlias(params.id);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
