import "server-only";

import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { getAnthropic } from "./anthropic";
import { loadAnalyzerSkill } from "./skill-loader";
import { summariseReportForAgent } from "./chat-types";
import type {
  ChatMessage,
  ChatToolCall,
  ChatResponseBody,
  ProposeBriefChangeInput,
} from "./chat-types";
import type { AnalysisBrief, AnalyzerReport } from "./report-types";

const MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ROUNDS = 4;

const TOOLS: Tool[] = [
  {
    name: "propose_brief_change",
    description:
      "Stage a change to the analysis brief. The change is NOT applied yet — it becomes part of a pending brief that the consultant will review and commit via the 'Re-run analysis' button. Use this when the user agrees to adjust an assumption (density, fuel mode, residential mix), add/remove a carrier fuel override, or exclude/un-exclude a lane suspected of being a data artefact. Always include a rationale.",
    input_schema: {
      type: "object",
      properties: {
        density_kg_per_m3: {
          type: "number",
          description: "Cubic weight density for volumetric calculations.",
        },
        residential_mix_pct: {
          type: "number",
          description: "0–100, share of shipments going to residential addresses.",
        },
        default_fuel_mode: {
          type: "string",
          enum: ["base", "with_fuel", "with_all_surcharges"],
          description: "Which fuel view drives the headline savings number.",
        },
        add_carrier_fuel_overrides: {
          type: "array",
          description: "Per-carrier fuel surcharge overrides to add or replace.",
          items: {
            type: "object",
            properties: {
              carrier_code: { type: "string" },
              fuel_pct: { type: "number" },
              note: { type: ["string", "null"] },
            },
            required: ["carrier_code", "fuel_pct"],
          },
        },
        remove_carrier_fuel_override_codes: {
          type: "array",
          description: "Carrier codes whose fuel overrides should be removed.",
          items: { type: "string" },
        },
        exclude_lane_ids: {
          type: "array",
          description:
            "Lane ids to exclude from the projection — use when a row is suspected duplicate, data artefact, or out-of-scope.",
          items: { type: "string" },
        },
        unexclude_lane_ids: {
          type: "array",
          description: "Lane ids to re-include after a prior exclusion.",
          items: { type: "string" },
        },
        notes: {
          type: ["string", "null"],
          description: "Free-text note attached to the brief.",
        },
        rationale: {
          type: "string",
          description:
            "Required. Short explanation of why this change is being proposed — surfaced to the consultant on the diff card.",
        },
      },
      required: ["rationale"],
    },
  },
];

export async function runChatTurn(args: {
  report: AnalyzerReport;
  pendingBrief: AnalysisBrief;
  history: ChatMessage[];
  message: string;
}): Promise<ChatResponseBody> {
  const anthropic = getAnthropic();
  const skill = await loadAnalyzerSkill().catch(() => null);

  const reportSummary = summariseReportForAgent(args.report);
  const system = buildSystemPrompt(args.report, args.pendingBrief, reportSummary, skill?.skillBody);

  // Convert prior turns into Anthropic message format. Tool calls are kept as
  // assistant tool_use blocks paired with user tool_result blocks.
  type SdkMsg = { role: "user" | "assistant"; content: unknown };
  const messages: SdkMsg[] = [];
  for (const m of args.history) {
    if (m.role === "assistant" && m.tool_calls?.length) {
      const blocks: unknown[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.tool_calls) {
        blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
      }
      messages.push({ role: "assistant", content: blocks });
      messages.push({
        role: "user",
        content: m.tool_calls.map((tc) => ({
          type: "tool_result",
          tool_use_id: tc.id,
          content: tc.result_summary,
        })),
      });
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  }
  messages.push({ role: "user", content: args.message });

  let pendingBrief = args.pendingBrief;
  const toolCalls: ChatToolCall[] = [];
  let finalText = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      temperature: 0.2,
      system,
      tools: TOOLS,
      messages: messages as never,
    });

    const assistantBlocks: unknown[] = [];
    const toolResults: unknown[] = [];
    const stopReason = resp.stop_reason;
    let roundText = "";

    for (const block of resp.content) {
      if (block.type === "text") {
        assistantBlocks.push({ type: "text", text: block.text });
        roundText += block.text;
      } else if (block.type === "tool_use") {
        assistantBlocks.push(block);
        const next = applyTool(block.name, block.input as Record<string, unknown>, pendingBrief);
        pendingBrief = next.brief;
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
          result_summary: next.summary,
          proposed_brief: next.brief,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: next.summary,
        });
      }
    }

    finalText = roundText;
    messages.push({ role: "assistant", content: assistantBlocks });

    if (stopReason !== "tool_use") break;
    messages.push({ role: "user", content: toolResults });
  }

  return {
    reply: finalText,
    toolCalls,
    pendingBrief,
    hasPendingChanges: !briefEqual(pendingBrief, args.pendingBrief),
  };
}

function buildSystemPrompt(
  report: AnalyzerReport,
  pendingBrief: AnalysisBrief,
  summary: string,
  skillBody?: string
): string {
  return [
    "You are TAC's Final Mile Analyzer co-pilot. A consultant is reading the report and wants to discuss findings, fix data issues, and propose changes to the underlying brief.",
    "",
    "## How you behave",
    "",
    "- Concise, plain English. No jargon unless the consultant uses it first.",
    "- When the consultant asks 'why is X?' or 'what about lane Y?', answer with specifics from the report — quote lane ids, CPOs, percentages, dollar values.",
    "- When you spot a fix the consultant should consider (exclude a duplicate lane, adjust density, swap fuel mode), propose it via the `propose_brief_change` tool. Do not just describe the change — call the tool so the consultant gets a reviewable diff card.",
    "- Tool calls accumulate into a pending brief. The consultant clicks 'Re-run analysis' on the UI when ready. You never trigger a re-run yourself.",
    "- If the consultant asks you to make multiple changes, you can call the tool multiple times in one turn.",
    "- If you're uncertain whether something is a data artefact vs. a real lane, ask the consultant before proposing an exclusion. Excluding a real lane silently corrupts the analysis.",
    "",
    "## Current report digest",
    "",
    summary,
    "",
    "## Current pending brief (what re-run will use)",
    "",
    "```json",
    JSON.stringify(pendingBrief, null, 2),
    "```",
    "",
    "## Critic findings (the consultant's existing blockers)",
    "",
    JSON.stringify(report.review.findings.slice(0, 20), null, 2),
    "",
    "## Full spend comparison table (use lane_ids from here when proposing exclusions)",
    "",
    JSON.stringify(report.spend_comparison.table, null, 2),
    skillBody ? "\n## Skill context\n\n" + skillBody : "",
  ].join("\n");
}

function applyTool(
  name: string,
  input: Record<string, unknown>,
  brief: AnalysisBrief
): { brief: AnalysisBrief; summary: string } {
  if (name !== "propose_brief_change") {
    return { brief, summary: `Unknown tool: ${name}` };
  }
  const change = input as unknown as ProposeBriefChangeInput;
  const next: AnalysisBrief = {
    ...brief,
    per_carrier_fuel_overrides: [...brief.per_carrier_fuel_overrides],
    service_tier_pair_overrides: [...brief.service_tier_pair_overrides],
    excluded_lane_ids: brief.excluded_lane_ids ? [...brief.excluded_lane_ids] : [],
  };
  const diffs: string[] = [];

  if (typeof change.density_kg_per_m3 === "number") {
    diffs.push(`density_kg_per_m3: ${brief.density_kg_per_m3} → ${change.density_kg_per_m3}`);
    next.density_kg_per_m3 = change.density_kg_per_m3;
  }
  if (typeof change.residential_mix_pct === "number") {
    diffs.push(`residential_mix_pct: ${brief.residential_mix_pct} → ${change.residential_mix_pct}`);
    next.residential_mix_pct = change.residential_mix_pct;
  }
  if (typeof change.default_fuel_mode === "string") {
    diffs.push(`default_fuel_mode: ${brief.default_fuel_mode} → ${change.default_fuel_mode}`);
    next.default_fuel_mode = change.default_fuel_mode;
  }
  if (typeof change.notes === "string" || change.notes === null) {
    diffs.push(`notes: updated`);
    next.notes = change.notes;
  }
  if (Array.isArray(change.add_carrier_fuel_overrides)) {
    for (const ov of change.add_carrier_fuel_overrides) {
      if (!ov?.carrier_code || typeof ov.fuel_pct !== "number") continue;
      next.per_carrier_fuel_overrides = next.per_carrier_fuel_overrides.filter(
        (x) => x.carrier_code !== ov.carrier_code
      );
      next.per_carrier_fuel_overrides.push({
        carrier_code: ov.carrier_code,
        fuel_pct: ov.fuel_pct,
        note: ov.note ?? null,
      });
      diffs.push(`fuel override ${ov.carrier_code} = ${ov.fuel_pct}%`);
    }
  }
  if (Array.isArray(change.remove_carrier_fuel_override_codes)) {
    for (const code of change.remove_carrier_fuel_override_codes) {
      if (!code) continue;
      const before = next.per_carrier_fuel_overrides.length;
      next.per_carrier_fuel_overrides = next.per_carrier_fuel_overrides.filter(
        (x) => x.carrier_code !== code
      );
      if (next.per_carrier_fuel_overrides.length !== before) diffs.push(`removed fuel override ${code}`);
    }
  }
  if (Array.isArray(change.exclude_lane_ids)) {
    const set = new Set(next.excluded_lane_ids ?? []);
    for (const id of change.exclude_lane_ids) {
      if (typeof id === "string" && id.trim()) {
        set.add(id.trim());
        diffs.push(`exclude lane ${id}`);
      }
    }
    next.excluded_lane_ids = Array.from(set);
  }
  if (Array.isArray(change.unexclude_lane_ids)) {
    const set = new Set(next.excluded_lane_ids ?? []);
    for (const id of change.unexclude_lane_ids) {
      if (typeof id === "string" && set.delete(id.trim())) {
        diffs.push(`re-include lane ${id}`);
      }
    }
    next.excluded_lane_ids = Array.from(set);
  }

  const rationale =
    typeof change.rationale === "string" && change.rationale.trim()
      ? change.rationale.trim()
      : "(no rationale provided)";

  if (next.excluded_lane_ids && next.excluded_lane_ids.length === 0) {
    delete next.excluded_lane_ids;
  }

  if (diffs.length === 0) {
    return {
      brief: next,
      summary: `No-op: propose_brief_change called with no actionable fields. Rationale: ${rationale}`,
    };
  }
  return {
    brief: next,
    summary: `Staged changes: ${diffs.join("; ")}. Rationale: ${rationale}. Pending — consultant must click Re-run to apply.`,
  };
}

function briefEqual(a: AnalysisBrief, b: AnalysisBrief): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
