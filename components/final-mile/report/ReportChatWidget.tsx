"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type {
  ChatMessage,
  ChatResponseBody,
  ChatToolCall,
} from "@/lib/analyzer/chat-types";
import type { AnalysisBrief } from "@/lib/analyzer/report-types";

interface ReportChatWidgetProps {
  analysisId: string;
  baseBrief: AnalysisBrief;
}

export default function ReportChatWidget({ analysisId, baseBrief }: ReportChatWidgetProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingBrief, setPendingBrief] = useState<AnalysisBrief>(baseBrief);
  const [error, setError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [refreshSnapshot, setRefreshSnapshot] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const pendingDiff = useMemo(() => diffBrief(baseBrief, pendingBrief), [baseBrief, pendingBrief]);
  const hasPending = pendingDiff.length > 0;

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      const userMsg: ChatMessage = { role: "user", content: trimmed };
      const nextHistory = [...messages, userMsg];
      setMessages(nextHistory);
      setInput("");
      setSending(true);
      setError(null);

      try {
        const res = await fetch("/api/analyzer/report-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            analysisId,
            pendingBrief,
            history: messages,
            message: trimmed,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Chat failed (${res.status})`);
        }
        const data = (await res.json()) as ChatResponseBody;
        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: data.reply,
          tool_calls: data.toolCalls,
        };
        setMessages([...nextHistory, assistantMsg]);
        setPendingBrief(data.pendingBrief);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Chat failed");
      } finally {
        setSending(false);
      }
    },
    [analysisId, messages, pendingBrief, sending]
  );

  const rerun = useCallback(async () => {
    if (rerunning || !hasPending) return;
    const rationale =
      window.prompt(
        "Short rationale for this re-run (e.g. 'Excluded Sydney Metro lanes — suspected duplicates'):"
      ) ?? "";
    if (!rationale.trim()) return;
    setRerunning(true);
    setError(null);
    try {
      const res = await fetch("/api/analyzer/rerun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent_analysis_id: analysisId,
          brief: pendingBrief,
          rationale: rationale.trim(),
          refresh_snapshot: refreshSnapshot,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; details?: string };
        throw new Error(body.error ?? body.details ?? `Re-run failed (${res.status})`);
      }
      const data = (await res.json()) as { id: string };
      router.push(`/final-mile/analyzer/report/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Re-run failed");
    } finally {
      setRerunning(false);
    }
  }, [analysisId, hasPending, pendingBrief, refreshSnapshot, rerunning, router]);

  const reset = useCallback(() => {
    setPendingBrief(baseBrief);
  }, [baseBrief]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-tac-accent px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-tac-accent/30 transition hover:bg-tac-bg"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        Ask about this report
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 flex h-[640px] w-[440px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <header className="flex items-center justify-between border-b border-slate-200 bg-tac-bg px-4 py-3 text-white">
        <div>
          <div className="text-sm font-semibold">Report co-pilot</div>
          <div className="text-xs text-white/70">Discuss findings · stage changes · re-run</div>
        </div>
        <button onClick={() => setOpen(false)} className="rounded p-1 text-white/80 hover:bg-white/10">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            <p className="font-medium text-slate-800">What I can help with:</p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
              <li>Walk you through any finding or lane in the table</li>
              <li>Stage brief changes (density, fuel mode, residential mix)</li>
              <li>Flag suspected duplicate / artefact lanes for exclusion</li>
              <li>Stage carrier-specific fuel overrides</li>
            </ul>
            <p className="mt-2 text-xs text-slate-500">
              Changes are staged as a pending brief — nothing re-computes until you click <span className="font-semibold">Re-run analysis</span>.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageBubble key={i} msg={m} />
        ))}
        {sending && (
          <div className="my-2 flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-tac-accent" />
            Thinking…
          </div>
        )}
        {error && (
          <div className="my-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">{error}</div>
        )}
      </div>

      {hasPending && (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                Pending changes ({pendingDiff.length})
              </div>
              <ul className="mt-1 space-y-0.5 text-xs text-amber-900">
                {pendingDiff.map((d, i) => (
                  <li key={i}>· {d}</li>
                ))}
              </ul>
            </div>
            <button
              onClick={reset}
              className="text-xs text-amber-700 underline hover:text-amber-900"
              disabled={rerunning}
            >
              clear
            </button>
          </div>
          <label className="mt-2 flex items-start gap-2 text-xs text-amber-900">
            <input
              type="checkbox"
              checked={refreshSnapshot}
              onChange={(e) => setRefreshSnapshot(e.target.checked)}
              disabled={rerunning}
              className="mt-0.5"
            />
            <span>
              Refresh data snapshot (re-pull volumes, rate cards, and aliases from the
              database before running). Use after mapping new service tiers or
              importing fresh data.
            </span>
          </label>
          <button
            onClick={rerun}
            disabled={rerunning}
            className="mt-2 w-full rounded-lg bg-tac-accent px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-tac-accent-hover disabled:opacity-60"
          >
            {rerunning ? "Re-running analysis…" : "Re-run analysis with these changes"}
          </button>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-end gap-2 border-t border-slate-200 bg-white p-3"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="Ask about a finding, lane, or assumption…"
          rows={2}
          disabled={sending || rerunning}
          className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-tac-accent focus:outline-none focus:ring-1 focus:ring-tac-accent"
        />
        <button
          type="submit"
          disabled={sending || rerunning || !input.trim()}
          className="rounded-lg bg-tac-accent px-3 py-2 text-sm font-semibold text-white transition hover:bg-tac-bg disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === "user") {
    return (
      <div className="my-2 flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-tac-bg px-3 py-2 text-sm text-white">
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    <div className="my-2 flex flex-col items-start gap-1.5">
      {msg.content && (
        <div className="max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 text-sm text-slate-800">
          {msg.content}
        </div>
      )}
      {msg.tool_calls?.map((tc) => <ToolCallCard key={tc.id} call={tc} />)}
    </div>
  );
}

function ToolCallCard({ call }: { call: ChatToolCall }) {
  return (
    <div className="w-full rounded-lg border border-tac-accent/40 bg-tac-accent/10 px-3 py-2 text-xs">
      <div className="flex items-center gap-1.5 font-semibold text-tac-accent">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
        Staged: {call.name}
      </div>
      <div className="mt-1 text-slate-700">{call.result_summary}</div>
    </div>
  );
}

function diffBrief(a: AnalysisBrief, b: AnalysisBrief): string[] {
  const out: string[] = [];
  if (a.density_kg_per_m3 !== b.density_kg_per_m3) {
    out.push(`density ${a.density_kg_per_m3} → ${b.density_kg_per_m3} kg/m³`);
  }
  if (a.residential_mix_pct !== b.residential_mix_pct) {
    out.push(`residential mix ${a.residential_mix_pct}% → ${b.residential_mix_pct}%`);
  }
  if (a.default_fuel_mode !== b.default_fuel_mode) {
    out.push(`fuel mode ${a.default_fuel_mode} → ${b.default_fuel_mode}`);
  }
  const aFuels = new Map(a.per_carrier_fuel_overrides.map((o) => [o.carrier_code, o.fuel_pct]));
  const bFuels = new Map(b.per_carrier_fuel_overrides.map((o) => [o.carrier_code, o.fuel_pct]));
  bFuels.forEach((pct, code) => {
    if (aFuels.get(code) !== pct) out.push(`fuel override ${code} = ${pct}%`);
  });
  aFuels.forEach((_pct, code) => {
    if (!bFuels.has(code)) out.push(`removed fuel override ${code}`);
  });
  const aEx = new Set(a.excluded_lane_ids ?? []);
  const bEx = new Set(b.excluded_lane_ids ?? []);
  bEx.forEach((id) => { if (!aEx.has(id)) out.push(`exclude ${id}`); });
  aEx.forEach((id) => { if (!bEx.has(id)) out.push(`re-include ${id}`); });
  if ((a.notes ?? "") !== (b.notes ?? "")) out.push(`notes updated`);
  return out;
}
