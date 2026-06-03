import { NextResponse } from "next/server";

import {
  createShareToken,
  listShareTokensForAnalysis,
  revokeShareToken,
} from "@/lib/actions/analysis-share-tokens";

export const runtime = "nodejs";

interface CreateBody {
  analysis_id: string;
  created_by_email?: string | null;
  expires_in_days?: number | null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CreateBody;
    if (!body.analysis_id) {
      return NextResponse.json({ error: "analysis_id is required" }, { status: 400 });
    }
    const token = await createShareToken({
      analysis_id: body.analysis_id,
      created_by_email: body.created_by_email ?? null,
      expires_in_days: body.expires_in_days ?? null,
    });
    return NextResponse.json({
      token: token.token,
      expires_at: token.expires_at,
      created_at: token.created_at,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const analysisId = searchParams.get("analysis_id");
  if (!analysisId) {
    return NextResponse.json({ error: "analysis_id query param required" }, { status: 400 });
  }
  try {
    const tokens = await listShareTokensForAnalysis(analysisId);
    return NextResponse.json({ tokens });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "token query param required" }, { status: 400 });
  }
  try {
    await revokeShareToken(token);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
