"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface AnalysisListItem {
  id: string;
  created_at: string;
  duration_ms: number | null;
  notes: string | null;
  period_label: string | null;
  report_state: "final" | "draft_only" | "blocked" | null;
  review_verdict: "pass" | "needs_revision" | "block" | null;
  annual_savings_aud: number | null;
  monthly_savings_aud: number | null;
  savings_pct: number | null;
}

interface PastAnalysesListProps {
  tenantId: string;
}

const STATE_STYLES: Record<NonNullable<AnalysisListItem["report_state"]>, { label: string; cls: string }> = {
  final: { label: "Final", cls: "bg-tac-success/20 text-tac-success" },
  draft_only: { label: "Draft", cls: "bg-tac-warning/20 text-tac-warning" },
  blocked: { label: "Blocked", cls: "bg-tac-danger/20 text-tac-danger" },
};

export default function PastAnalysesList({ tenantId }: PastAnalysesListProps) {
  const [items, setItems] = useState<AnalysisListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (item: AnalysisListItem) => {
    const label = item.period_label ?? fmtDate(item.created_at);
    if (!window.confirm(`Delete this analysis (${label})? This cannot be undone.`)) return;
    setDeletingId(item.id);
    setError(null);
    try {
      const res = await fetch(`/api/analyzer/list?id=${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Delete failed (${res.status})`);
      }
      setItems((prev) => (prev ? prev.filter((it) => it.id !== item.id) : prev));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    fetch(`/api/analyzer/list?tenant_id=${encodeURIComponent(tenantId)}&limit=15`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to load analyses (${res.status})`);
        }
        return (await res.json()) as { items: AnalysisListItem[] };
      })
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load analyses");
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  if (error) {
    return (
      <div className="card border-tac-danger/40 bg-tac-danger/10 text-sm text-tac-danger">
        Could not load past analyses: {error}
      </div>
    );
  }

  if (items === null) {
    return (
      <div className="card text-sm text-tac-muted">Loading past analyses…</div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="card text-sm text-tac-muted">
        No past analyses for this tenant yet. Run your first one below.
      </div>
    );
  }

  return (
    <section className="card space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Past analyses</h3>
          <p className="text-xs text-tac-muted">
            Open a prior run instead of re-executing — re-runs save time and tokens. Most recent first.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-tac-accent hover:underline"
        >
          {expanded ? "Hide" : `Show (${items.length})`}
        </button>
      </div>

      {expanded && (
        <div className="space-y-1.5">
          {items.map((item) => {
            const isDeleting = deletingId === item.id;
            return (
              <div
                key={item.id}
                className="group grid grid-cols-[1fr_auto_auto] gap-3 items-center rounded border border-tac-border bg-tac-bg-card/40 hover:border-tac-accent/60 hover:bg-tac-bg-card/70 transition-colors"
              >
                <Link
                  href={`/final-mile/analyzer/report/${item.id}`}
                  className="min-w-0 py-2.5 pl-3"
                >
                  <div className="flex items-center gap-2 text-sm font-medium truncate">
                    <span>{item.period_label ?? "(no period label)"}</span>
                    {item.report_state && (
                      <span
                        className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 ${
                          STATE_STYLES[item.report_state].cls
                        }`}
                      >
                        {STATE_STYLES[item.report_state].label}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-tac-muted mt-0.5">
                    {fmtDate(item.created_at)}
                    {item.duration_ms != null && (
                      <span> · {(item.duration_ms / 1000).toFixed(0)}s</span>
                    )}
                    {item.notes && (
                      <span className="truncate"> · {truncate(item.notes, 60)}</span>
                    )}
                  </div>
                </Link>
                <Link
                  href={`/final-mile/analyzer/report/${item.id}`}
                  className="text-right whitespace-nowrap py-2.5"
                >
                  {item.annual_savings_aud != null ? (
                    <>
                      <div
                        className={`text-sm font-semibold ${
                          item.annual_savings_aud > 0
                            ? "text-tac-success"
                            : item.annual_savings_aud < 0
                            ? "text-tac-danger"
                            : "text-tac-muted"
                        }`}
                      >
                        {fmtAud(item.annual_savings_aud)}/yr
                      </div>
                      {item.savings_pct != null && (
                        <div className="text-[11px] text-tac-muted">
                          {item.savings_pct > 0 ? "+" : ""}
                          {item.savings_pct.toFixed(1)}%
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-xs text-tac-muted">no headline</div>
                  )}
                </Link>
                <button
                  type="button"
                  onClick={() => handleDelete(item)}
                  disabled={isDeleting}
                  title="Delete analysis"
                  aria-label="Delete analysis"
                  className="opacity-40 hover:opacity-100 hover:text-tac-danger text-tac-muted p-2 mr-1 rounded transition-opacity disabled:opacity-30 disabled:cursor-wait"
                >
                  {isDeleting ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6" />
                    </svg>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function fmtAud(n: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
