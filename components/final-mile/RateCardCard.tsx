"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FreightRateCardLine,
  FreightRateCardWithDetails,
  RateBasis,
  RateCardStatus,
} from "@/lib/db/types";
import ThinkingIndicator from "@/components/shared/ThinkingIndicator";

interface RateCardCardProps {
  card: FreightRateCardWithDetails;
  onChanged: () => void;
}

const RATE_BASIS_OPTIONS: { value: RateBasis; label: string }[] = [
  { value: "per_parcel", label: "Per parcel" },
  { value: "per_kg", label: "Per kg" },
  { value: "per_parcel_plus_per_kg", label: "Per parcel + per kg" },
];

const STATUS_LABELS: Record<RateCardStatus, string> = {
  current: "current",
  new: "new / proposed",
  archived: "archived",
};

interface TransformLogEntry {
  at: string;
  instruction: string;
  summary: string;
  warnings: string[];
  lines_before: number;
  lines_applied: number;
}

export default function RateCardCard({ card, onChanged }: RateCardCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [label, setLabel] = useState(card.label ?? "");
  const [fuelPct, setFuelPct] = useState(
    card.fuel_surcharge_percent !== null ? String(card.fuel_surcharge_percent) : ""
  );
  const [savingState, setSavingState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [running, setRunning] = useState(false);
  const [transformError, setTransformError] = useState<string | null>(null);
  const [history, setHistory] = useState<TransformLogEntry[]>([]);

  // Reset local state if upstream card changes
  useEffect(() => {
    setLabel(card.label ?? "");
    setFuelPct(card.fuel_surcharge_percent !== null ? String(card.fuel_surcharge_percent) : "");
  }, [card.id, card.label, card.fuel_surcharge_percent]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queueSave = useCallback(
    (patch: Record<string, unknown>) => {
      setSavingState("saving");
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/rate-cards/${card.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Failed (${res.status})`);
          }
          setSavingState("saved");
          setError(null);
          setTimeout(() => setSavingState("idle"), 1200);
        } catch (e: unknown) {
          setSavingState("error");
          setError(e instanceof Error ? e.message : "Save failed");
        }
      }, 600);
    },
    [card.id]
  );

  const handleLabelChange = (v: string) => {
    setLabel(v);
    queueSave({ label: v });
  };
  const handleFuelChange = (v: string) => {
    setFuelPct(v);
    queueSave({ fuel_surcharge_percent: v === "" ? null : Number(v) });
  };

  const handleStatusChange = async (newStatus: RateCardStatus) => {
    try {
      const res = await fetch(`/api/rate-cards/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      onChanged();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Status change failed");
    }
  };

  const runTransform = async () => {
    const trimmed = instruction.trim();
    if (!trimmed || running) return;
    setRunning(true);
    setTransformError(null);
    try {
      const res = await fetch(`/api/rate-cards/${card.id}/transform`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: trimmed }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `Transform failed (${res.status})`);
      }
      setHistory((prev) => [
        {
          at: new Date().toISOString(),
          instruction: trimmed,
          summary: typeof json.summary === "string" ? json.summary : "",
          warnings: Array.isArray(json.warnings) ? json.warnings : [],
          lines_before: typeof json.lines_before === "number" ? json.lines_before : 0,
          lines_applied: typeof json.lines_applied === "number" ? json.lines_applied : 0,
        },
        ...prev,
      ]);
      setInstruction("");
      onChanged();
    } catch (e: unknown) {
      setTransformError(e instanceof Error ? e.message : "Transform failed");
    } finally {
      setRunning(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete this rate card and all ${card.lines.length} lines?`)) return;
    try {
      const res = await fetch(`/api/rate-cards/${card.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      onChanged();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const sortedLines = [...card.lines].sort((a, b) => {
    if (a.zone_label !== b.zone_label) return a.zone_label.localeCompare(b.zone_label);
    return (a.weight_min_kg ?? 0) - (b.weight_min_kg ?? 0);
  });

  return (
    <div className="card space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-tac-text font-semibold">{card.carrier.name}</span>
            <span className="text-tac-muted">·</span>
            <span className="text-tac-text">{card.service_level}</span>
            <span className="text-xs text-tac-muted bg-tac-bg-light px-2 py-0.5 rounded ml-1">
              {STATUS_LABELS[card.status]}
            </span>
          </div>
          <div className="text-xs text-tac-muted">
            {card.lines.length} line{card.lines.length === 1 ? "" : "s"}
            {card.effective_from && ` · from ${card.effective_from}`}
            {card.effective_to && ` to ${card.effective_to}`}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <SaveIndicator state={savingState} />
          {card.status === "new" && (
            <button
              type="button"
              onClick={() => handleStatusChange("current")}
              className="text-xs border border-tac-success/40 text-tac-success px-3 py-1 rounded hover:bg-tac-success/10"
              title="Mark this card as the active current rate card"
            >
              Promote → current
            </button>
          )}
          {card.status === "current" && (
            <button
              type="button"
              onClick={() => handleStatusChange("archived")}
              className="text-xs border border-tac-border text-tac-muted px-3 py-1 rounded hover:border-tac-text"
            >
              Archive
            </button>
          )}
          <button
            type="button"
            onClick={handleDelete}
            className="text-xs text-tac-danger hover:underline"
          >
            delete
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-sm border border-tac-border px-3 py-1 rounded hover:border-tac-accent"
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Label">
          <input
            type="text"
            value={label}
            onChange={(e) => handleLabelChange(e.target.value)}
            placeholder={`${card.carrier.name} ${card.service_level}`}
            className="input-field text-sm"
          />
        </Field>
        <Field label="Fuel surcharge (%)">
          <input
            type="number"
            step="0.01"
            value={fuelPct}
            onChange={(e) => handleFuelChange(e.target.value)}
            className="input-field text-sm"
          />
        </Field>
        <Field label="Status">
          <select
            value={card.status}
            onChange={(e) => handleStatusChange(e.target.value as RateCardStatus)}
            className="input-field text-sm"
          >
            <option value="current">current</option>
            <option value="new">new / proposed</option>
            <option value="archived">archived</option>
          </select>
        </Field>
      </div>

      <div className="space-y-2">
        <Field label="Instruction — Claude rewrites the rate lines">
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={2}
            disabled={running}
            placeholder='e.g. "make rates exclusive of GST", "round all rates to nearest 5 cents", "add 8% to Metro NSW only"'
            className="input-field text-sm resize-y disabled:opacity-60"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void runTransform();
              }
            }}
          />
        </Field>
        <div className="flex justify-between items-center gap-3 flex-wrap">
          <p className="text-xs text-tac-muted">
            Runs across all {card.lines.length} lines. ⌘/Ctrl + Enter to apply. Review the
            table below — every change is editable.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            {running && <ThinkingIndicator inline kind="transform" />}
            <button
              type="button"
              onClick={runTransform}
              disabled={!instruction.trim() || running}
              className="bg-tac-accent text-tac-bg font-semibold px-4 py-1.5 rounded text-sm hover:bg-tac-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {running ? "Applying…" : "Apply instruction"}
            </button>
          </div>
        </div>
        {transformError && (
          <div className="rounded border border-tac-danger/40 bg-tac-danger/10 px-3 py-2 text-sm text-tac-danger">
            {transformError}
          </div>
        )}
        {history.length > 0 && (
          <div className="border border-tac-border rounded p-3 space-y-2 bg-tac-bg-light/40">
            <p className="text-xs uppercase tracking-wide text-tac-muted">Recent runs</p>
            {history.slice(0, 3).map((entry, i) => (
              <div key={`${entry.at}-${i}`} className="text-xs space-y-1">
                <p className="text-tac-text">
                  <span className="text-tac-success">✓</span>{" "}
                  <span className="italic">&ldquo;{entry.instruction}&rdquo;</span>
                  {entry.lines_applied > 0 && (
                    <span className="text-tac-muted">
                      {" "}
                      · {entry.lines_applied}/{entry.lines_before} lines
                    </span>
                  )}
                </p>
                {entry.summary && <p className="text-tac-muted pl-4">{entry.summary}</p>}
                {entry.warnings.length > 0 && (
                  <ul className="list-disc pl-8 text-tac-warning">
                    {entry.warnings.map((w, j) => (
                      <li key={j}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded border border-tac-danger/40 bg-tac-danger/10 px-3 py-2 text-sm text-tac-danger">
          {error}
        </div>
      )}

      {expanded && (
        <RateLinesEditor
          rateCardId={card.id}
          lines={sortedLines}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}

function RateLinesEditor({
  rateCardId,
  lines,
  onChanged,
}: {
  rateCardId: string;
  lines: FreightRateCardLine[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);

  const addLine = useCallback(async () => {
    setAdding(true);
    try {
      const res = await fetch(`/api/rate-cards/${rateCardId}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zone_label: "New zone",
          rate_basis: "per_parcel",
          rate_aud: 0,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      onChanged();
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : "Failed to add line");
    } finally {
      setAdding(false);
    }
  }, [rateCardId, onChanged]);

  return (
    <div className="border-t border-tac-border pt-4">
      <div className="flex items-baseline justify-between mb-3">
        <h4 className="font-semibold text-sm">Rate lines</h4>
        <button
          type="button"
          onClick={addLine}
          disabled={adding}
          className="text-sm border border-tac-border px-3 py-1 rounded hover:border-tac-accent disabled:opacity-50"
        >
          + Add row
        </button>
      </div>
      {lines.length === 0 ? (
        <div className="text-sm text-tac-muted italic">
          No lines yet. Add a row to start populating this card.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-tac-muted border-b border-tac-border">
                <Th>Zone</Th>
                <Th>Description</Th>
                <Th right>Min kg</Th>
                <Th right>Max kg</Th>
                <Th>Basis</Th>
                <Th right>Rate</Th>
                <Th right>Per kg</Th>
                <Th right>Min $</Th>
                <Th>Notes</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <LineRow key={line.id} line={line} onChanged={onChanged} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LineRow({
  line,
  onChanged,
}: {
  line: FreightRateCardLine;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState({
    zone_label: line.zone_label,
    zone_description: line.zone_description ?? "",
    weight_min_kg: line.weight_min_kg,
    weight_max_kg: line.weight_max_kg,
    rate_basis: line.rate_basis,
    rate_aud: line.rate_aud,
    per_kg_rate_aud: line.per_kg_rate_aud,
    minimum_charge_aud: line.minimum_charge_aud,
    notes: line.notes ?? "",
  });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Sync if upstream line changes
  useEffect(() => {
    setDraft({
      zone_label: line.zone_label,
      zone_description: line.zone_description ?? "",
      weight_min_kg: line.weight_min_kg,
      weight_max_kg: line.weight_max_kg,
      rate_basis: line.rate_basis,
      rate_aud: line.rate_aud,
      per_kg_rate_aud: line.per_kg_rate_aud,
      minimum_charge_aud: line.minimum_charge_aud,
      notes: line.notes ?? "",
    });
  }, [line]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queueSave = useCallback(
    (patch: Record<string, unknown>) => {
      setSaveState("saving");
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/rate-cards/lines/${line.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Failed (${res.status})`);
          }
          setSaveState("saved");
          setTimeout(() => setSaveState("idle"), 1000);
        } catch (e: unknown) {
          setSaveState("error");
          window.alert(e instanceof Error ? e.message : "Save failed");
        }
      }, 600);
    },
    [line.id]
  );

  const update = (patch: Partial<typeof draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    queueSave(patch);
  };

  const remove = async () => {
    if (!window.confirm("Delete this line?")) return;
    try {
      const res = await fetch(`/api/rate-cards/lines/${line.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      onChanged();
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <tr className={`border-b border-tac-border/60 ${saveState === "error" ? "bg-tac-danger/10" : ""}`}>
      <TdInput
        value={draft.zone_label}
        onChange={(v) => update({ zone_label: v })}
      />
      <TdInput
        value={draft.zone_description}
        onChange={(v) => update({ zone_description: v })}
      />
      <TdInput
        value={draft.weight_min_kg ?? ""}
        type="number"
        onChange={(v) => update({ weight_min_kg: v === "" ? null : Number(v) })}
        right
      />
      <TdInput
        value={draft.weight_max_kg ?? ""}
        type="number"
        onChange={(v) => update({ weight_max_kg: v === "" ? null : Number(v) })}
        right
      />
      <td className="px-2 py-1">
        <select
          value={draft.rate_basis}
          onChange={(e) => update({ rate_basis: e.target.value as RateBasis })}
          className="input-field text-sm py-1"
        >
          {RATE_BASIS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </td>
      <TdInput
        value={draft.rate_aud}
        type="number"
        onChange={(v) => update({ rate_aud: v === "" ? 0 : Number(v) })}
        right
      />
      <TdInput
        value={draft.per_kg_rate_aud ?? ""}
        type="number"
        onChange={(v) => update({ per_kg_rate_aud: v === "" ? null : Number(v) })}
        right
      />
      <TdInput
        value={draft.minimum_charge_aud ?? ""}
        type="number"
        onChange={(v) => update({ minimum_charge_aud: v === "" ? null : Number(v) })}
        right
      />
      <TdInput value={draft.notes} onChange={(v) => update({ notes: v })} />
      <td className="px-2 py-1 whitespace-nowrap">
        {saveState === "saving" && <span className="text-xs text-tac-muted">…</span>}
        {saveState === "saved" && <span className="text-xs text-tac-success">✓</span>}
        <button
          type="button"
          onClick={remove}
          className="text-xs text-tac-danger hover:underline ml-2"
        >
          remove
        </button>
      </td>
    </tr>
  );
}

function SaveIndicator({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  if (state === "idle") return null;
  if (state === "saving")
    return <span className="text-xs text-tac-muted">saving…</span>;
  if (state === "saved")
    return <span className="text-xs text-tac-success">✓ saved</span>;
  return <span className="text-xs text-tac-danger">save failed</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-tac-muted block mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-2 py-2 text-xs uppercase tracking-wide font-medium ${
        right ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}

function TdInput({
  value,
  onChange,
  type = "text",
  right,
}: {
  value: string | number;
  onChange: (v: string) => void;
  type?: "text" | "number";
  right?: boolean;
}) {
  return (
    <td className="px-2 py-1">
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`input-field text-sm py-1 w-full ${right ? "text-right" : ""}`}
      />
    </td>
  );
}
