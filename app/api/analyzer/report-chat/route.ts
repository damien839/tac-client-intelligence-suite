import { NextResponse } from "next/server";

import { runChatTurn } from "@/lib/analyzer/chat-agent";
import { getAnalysis } from "@/lib/actions/freight-analyses";
import type { ChatRequestBody, ChatResponseBody } from "@/lib/analyzer/chat-types";
import type { AnalysisBrief, AnalyzerReport } from "@/lib/analyzer/report-types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ChatRequestBody;
    if (!body.analysisId) {
      return NextResponse.json({ error: "analysisId is required" }, { status: 400 });
    }
    if (typeof body.message !== "string" || body.message.trim().length === 0) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const record = await getAnalysis(body.analysisId);
    if (!record) {
      return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
    }

    const report = record.report_json as AnalyzerReport;
    const baseBrief: AnalysisBrief = report.brief;
    const pendingBrief: AnalysisBrief = body.pendingBrief ?? baseBrief;

    const result: ChatResponseBody = await runChatTurn({
      report,
      pendingBrief,
      history: body.history ?? [],
      message: body.message,
    });

    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
