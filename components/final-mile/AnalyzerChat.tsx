"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnalyzerChatProps {
  tenantId: string;
}

export default function AnalyzerChat({ tenantId }: AnalyzerChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streaming]);

  // Reset chat when tenant changes
  useEffect(() => {
    setMessages([]);
    setInput("");
    setError(null);
    abortRef.current?.abort();
  }, [tenantId]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;

      const nextHistory: ChatMessage[] = [
        ...messages,
        { role: "user", content: trimmed },
      ];
      setMessages([...nextHistory, { role: "assistant", content: "" }]);
      setInput("");
      setStreaming(true);
      setError(null);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/analyzer/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenant_id: tenantId, messages: nextHistory }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `Chat failed (${res.status})`);
        }
        if (!res.body) {
          throw new Error("Streaming response missing body");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffered = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffered += decoder.decode(value, { stream: true });
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = { ...last, content: buffered };
            }
            return next;
          });
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return;
        const message = e instanceof Error ? e.message : "Chat error";
        setError(message);
        setMessages((prev) => {
          const next = [...prev];
          if (next.length > 0 && next[next.length - 1].role === "assistant") {
            next.pop();
          }
          return next;
        });
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, streaming, tenantId]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void send(input);
    },
    [input, send]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void send(input);
      }
    },
    [input, send]
  );

  const executeAnalysis = useCallback(async () => {
    if (executing || streaming) return;
    setExecuting(true);
    setError(null);
    try {
      const res = await fetch("/api/analyzer/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || `Analysis failed (${res.status})`);
      }
      window.open(`/final-mile/analyzer/report/${body.id}`, "_blank", "noopener,noreferrer");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Analysis failed";
      setError(message);
    } finally {
      setExecuting(false);
    }
  }, [executing, streaming, tenantId]);

  return (
    <div className="flex flex-col h-[calc(100vh-220px)] min-h-[480px]">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xl font-semibold">Analyzer</h2>
          <p className="text-sm text-tac-muted mt-1">
            Talk to the data, edit fields, or generate the full savings report.
          </p>
        </div>
        <button
          type="button"
          onClick={executeAnalysis}
          disabled={executing || streaming}
          className="bg-tac-accent text-tac-bg font-semibold px-5 py-2.5 rounded hover:bg-tac-accent-hover disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {executing ? "Running…" : "Execute Analysis →"}
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto rounded border border-tac-border bg-tac-bg-card/40 p-4 space-y-4"
      >
        {messages.length === 0 && !streaming && (
          <EmptyState />
        )}
        {messages.map((m, idx) => (
          <MessageBubble key={idx} message={m} />
        ))}
        {streaming && messages[messages.length - 1]?.content === "" && (
          <div className="text-sm text-tac-muted italic">analyzing…</div>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded border border-tac-danger/40 bg-tac-danger/10 px-3 py-2 text-sm text-tac-danger">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-3 flex gap-2 items-end">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder="Ask about volumes, charges, savings, or request a tweak…"
          className="flex-1 rounded border border-tac-border bg-tac-bg-card px-3 py-2 text-sm focus:border-tac-accent focus:outline-none resize-none"
          disabled={streaming}
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          className="bg-tac-bg-light border border-tac-border text-tac-text font-medium px-4 py-2 rounded hover:border-tac-accent disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
          isUser
            ? "bg-tac-accent/15 border border-tac-accent/30 text-tac-text"
            : "bg-tac-bg-light border border-tac-border text-tac-text"
        }`}
      >
        {message.content || <span className="text-tac-muted italic">…</span>}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-sm text-tac-muted space-y-3">
      <p className="font-medium text-tac-text">Try asking:</p>
      <ul className="space-y-1.5 list-disc list-inside">
        <li>Summarise the current rate cards vs the new ones.</li>
        <li>Which lanes look cheapest under the new card?</li>
        <li>What&apos;s our biggest cost-per-order risk right now?</li>
        <li>How much do we ship to NSW vs VIC each month?</li>
      </ul>
      <p className="pt-2">
        Or hit <span className="text-tac-accent font-semibold">Execute Analysis</span> to generate the
        full savings report (opens in a new tab).
      </p>
    </div>
  );
}
