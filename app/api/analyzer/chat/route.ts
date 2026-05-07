import { NextResponse } from "next/server";
import { loadAnalyzerSkill } from "@/lib/analyzer/skill-loader";
import { buildAnalyzerSnapshot } from "@/lib/analyzer/snapshot";
import { getAnthropic } from "@/lib/analyzer/anthropic";

export const runtime = "nodejs";
export const maxDuration = 120;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequestBody {
  tenant_id: string;
  messages: ChatMessage[];
  pending_changes?: unknown[];
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ChatRequestBody;
    if (!body.tenant_id) {
      return NextResponse.json({ error: "tenant_id is required" }, { status: 400 });
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json({ error: "messages must be a non-empty array" }, { status: 400 });
    }

    const [skill, snapshot] = await Promise.all([
      loadAnalyzerSkill(),
      buildAnalyzerSnapshot(body.tenant_id),
    ]);

    const systemPrompt = buildChatSystemPrompt(skill);
    const contextBlock = buildContextBlock(snapshot, body.pending_changes ?? []);

    const userMessages: { role: "user" | "assistant"; content: string }[] = [
      { role: "user", content: contextBlock },
      ...body.messages,
    ];

    const anthropic = getAnthropic();
    const stream = await anthropic.messages.stream({
      model: skill.frontmatter.runtime.chat_model,
      max_tokens: skill.frontmatter.runtime.max_tokens_chat,
      temperature: skill.frontmatter.runtime.temperature_chat,
      system: systemPrompt,
      messages: userMessages,
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function buildChatSystemPrompt(skill: Awaited<ReturnType<typeof loadAnalyzerSkill>>) {
  return [
    skill.chatPrompt,
    "",
    "## Reference material (read as needed)",
    "",
    skill.referencesBundle,
  ].join("\n");
}

function buildContextBlock(
  snapshot: Awaited<ReturnType<typeof buildAnalyzerSnapshot>>,
  pendingChanges: unknown[]
): string {
  return [
    "<context>",
    `<tenant>${JSON.stringify(snapshot.tenant)}</tenant>`,
    `<volumes>${JSON.stringify(snapshot.volumes)}</volumes>`,
    `<current_rate_cards>${JSON.stringify(snapshot.current_rate_cards)}</current_rate_cards>`,
    `<new_rate_cards>${JSON.stringify(snapshot.new_rate_cards)}</new_rate_cards>`,
    `<pending_changes>${JSON.stringify(pendingChanges)}</pending_changes>`,
    "</context>",
  ].join("\n");
}
