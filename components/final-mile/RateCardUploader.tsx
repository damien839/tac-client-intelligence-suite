"use client";

import { useCallback, useMemo, useState } from "react";
import Papa from "papaparse";
import type { Carrier, RateBasis, RateCardStatus } from "@/lib/db/types";
import type {
  CreateRateCardInput,
  RateCardLineInput,
} from "@/lib/actions/rate-cards";
import { SERVICE_LEVEL_OPTIONS } from "@/lib/constants/service-levels";

interface RateCardUploaderProps {
  tenantId: string;
  status: RateCardStatus;
  carriers: Carrier[];
  onCreated: () => void;
}

interface DraftLine extends RateCardLineInput {
  __id: string;
}

const TEMPLATE_HEADERS = [
  "Zone",
  "Zone Description",
  "Weight Min (kg)",
  "Weight Max (kg)",
  "Rate Basis",
  "Rate (AUD)",
  "Per kg Rate (AUD)",
  "Minimum Charge (AUD)",
  "Notes",
];

const RATE_BASIS_OPTIONS: { value: RateBasis; label: string }[] = [
  { value: "per_parcel", label: "Per parcel" },
  { value: "per_kg", label: "Per kg" },
  { value: "per_parcel_plus_per_kg", label: "Per parcel + per kg" },
];

export default function RateCardUploader({
  tenantId,
  status,
  carriers,
  onCreated,
}: RateCardUploaderProps) {
  const [open, setOpen] = useState(false);
  const [carrierId, setCarrierId] = useState("");
  const [serviceLevel, setServiceLevel] = useState("");
  const [label, setLabel] = useState("");
  const [fuelPct, setFuelPct] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [notes, setNotes] = useState("");
  const [drafts, setDrafts] = useState<DraftLine[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [parsing, setParsing] = useState<null | "csv" | "excel" | "ai">(null);
  const [lastFileName, setLastFileName] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = useCallback(() => {
    setCarrierId("");
    setServiceLevel("");
    setLabel("");
    setFuelPct("");
    setEffectiveFrom("");
    setEffectiveTo("");
    setNotes("");
    setDrafts([]);
    setParseError(null);
    setParseWarnings([]);
    setParsing(null);
    setLastFileName(null);
    setSubmitError(null);
  }, []);

  const ingestRows = useCallback(
    (rows: DraftLine[], fileName: string, warnings: string[] = []) => {
      if (rows.length === 0) {
        setParseError(
          `No rate lines found in ${fileName}. Try a different file or add rows manually.`
        );
        setParseWarnings(warnings);
        return;
      }
      setDrafts(rows);
      setParseWarnings(warnings);
      setLastFileName(fileName);
    },
    []
  );

  const handleCsv = useCallback(
    (file: File) => {
      setParsing("csv");
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          setParsing(null);
          if (results.errors.length > 0) {
            setParseError(results.errors[0].message);
            return;
          }
          const rows: DraftLine[] = (results.data ?? [])
            .map((row, idx) => mapCsvRow(row, idx))
            .filter((r): r is DraftLine => r !== null);
          ingestRows(rows, file.name);
        },
        error: (err) => {
          setParsing(null);
          setParseError(err.message);
        },
      });
    },
    [ingestRows]
  );

  const handleExcel = useCallback(
    async (file: File) => {
      setParsing("excel");
      try {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheetName = wb.SheetNames[0];
        if (!sheetName) {
          setParseError("No sheets found in workbook");
          return;
        }
        const sheet = wb.Sheets[sheetName];
        const rowsRaw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
          defval: "",
          raw: false,
        });
        const stringified: Record<string, string>[] = rowsRaw.map((r) => {
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(r)) {
            out[k] = v == null ? "" : String(v);
          }
          return out;
        });
        const rows: DraftLine[] = stringified
          .map((row, idx) => mapCsvRow(row, idx))
          .filter((r): r is DraftLine => r !== null);
        ingestRows(rows, `${file.name} → ${sheetName}`);
      } catch (e: unknown) {
        setParseError(
          e instanceof Error ? `Excel parse failed: ${e.message}` : "Excel parse failed"
        );
      } finally {
        setParsing(null);
      }
    },
    [ingestRows]
  );

  const handleAiExtract = useCallback(
    async (file: File) => {
      setParsing("ai");
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/rate-cards/extract", {
          method: "POST",
          body: fd,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json.error || `Extract failed (${res.status})`);
        }
        const lines = Array.isArray(json.lines) ? (json.lines as RateCardLineInput[]) : [];
        const warnings = Array.isArray(json.warnings) ? (json.warnings as string[]) : [];
        const rows: DraftLine[] = lines.map((l, idx) => ({
          ...l,
          __id: `ai-${idx}-${crypto.randomUUID()}`,
        }));
        ingestRows(rows, file.name, warnings);
      } catch (e: unknown) {
        setParseError(
          e instanceof Error ? e.message : "Extraction failed — try a clearer file."
        );
      } finally {
        setParsing(null);
      }
    },
    [ingestRows]
  );

  const handleFile = useCallback(
    (file: File) => {
      setParseError(null);
      setParseWarnings([]);
      const kind = detectFileKind(file);
      if (kind === "csv") void handleCsv(file);
      else if (kind === "excel") void handleExcel(file);
      else if (kind === "ai") void handleAiExtract(file);
      else
        setParseError(
          `Unsupported file type "${file.name}". Use CSV, Excel, PDF, or image (PNG/JPG/WEBP).`
        );
    },
    [handleCsv, handleExcel, handleAiExtract]
  );

  const updateDraft = useCallback(
    (id: string, patch: Partial<DraftLine>) => {
      setDrafts((prev) =>
        prev.map((d) => (d.__id === id ? { ...d, ...patch } : d))
      );
    },
    []
  );

  const removeDraft = useCallback((id: string) => {
    setDrafts((prev) => prev.filter((d) => d.__id !== id));
  }, []);

  const addBlankDraft = useCallback(() => {
    setDrafts((prev) => [
      ...prev,
      {
        __id: crypto.randomUUID(),
        zone_label: "",
        zone_description: "",
        weight_min_kg: null,
        weight_max_kg: null,
        rate_basis: "per_parcel",
        rate_aud: 0,
        per_kg_rate_aud: null,
        minimum_charge_aud: null,
        notes: "",
      },
    ]);
  }, []);

  const downloadTemplate = useCallback(() => {
    const csv = Papa.unparse({
      fields: TEMPLATE_HEADERS,
      data: [
        ["Metro NSW", "Sydney metro postcodes", "0", "1", "per_parcel", "8.50", "", "", ""],
        ["Metro NSW", "Sydney metro postcodes", "1", "3", "per_parcel", "10.20", "", "", ""],
        ["Regional VIC", "Outside Melbourne metro", "0", "5", "per_parcel_plus_per_kg", "12.00", "0.85", "12.00", ""],
      ],
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rate-card-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const canSubmit = useMemo(() => {
    if (!carrierId || !serviceLevel.trim() || drafts.length === 0) return false;
    return drafts.every(
      (d) => d.zone_label.trim() && Number.isFinite(d.rate_aud) && d.rate_aud >= 0
    );
  }, [carrierId, serviceLevel, drafts]);

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload: CreateRateCardInput = {
        tenant_id: tenantId,
        carrier_id: carrierId,
        service_level: serviceLevel,
        status,
        label: label || null,
        fuel_surcharge_percent: fuelPct ? Number(fuelPct) : null,
        effective_from: effectiveFrom || null,
        effective_to: effectiveTo || null,
        notes: notes || null,
        lines: drafts.map(({ __id, ...rest }) => {
          void __id;
          return rest;
        }),
      };
      const res = await fetch("/api/rate-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      reset();
      setOpen(false);
      onCreated();
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit,
    tenantId,
    carrierId,
    serviceLevel,
    status,
    label,
    fuelPct,
    effectiveFrom,
    effectiveTo,
    notes,
    drafts,
    onCreated,
    reset,
  ]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-tac-accent text-tac-bg font-semibold px-4 py-2 rounded hover:bg-tac-accent-hover text-sm"
      >
        + Upload rate card
      </button>
    );
  }

  return (
    <div className="card border-tac-accent/40 space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-lg font-semibold">
          New {status === "new" ? "proposed" : "current"} rate card
        </h3>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="text-sm text-tac-muted hover:text-tac-text"
        >
          cancel
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Carrier *">
          <select
            value={carrierId}
            onChange={(e) => setCarrierId(e.target.value)}
            className="input-field"
          >
            <option value="">Select carrier…</option>
            {carriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Service level *">
          <select
            value={serviceLevel}
            onChange={(e) => setServiceLevel(e.target.value)}
            className="input-field"
          >
            <option value="">Select service level…</option>
            {SERVICE_LEVEL_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Label">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="AusPost Standard FY26"
            className="input-field"
          />
        </Field>
        <Field label="Fuel surcharge (%)">
          <input
            type="number"
            step="0.01"
            value={fuelPct}
            onChange={(e) => setFuelPct(e.target.value)}
            placeholder="e.g. 12.5"
            className="input-field"
          />
        </Field>
        <Field label="Effective from">
          <input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className="input-field"
          />
        </Field>
        <Field label="Effective to">
          <input
            type="date"
            value={effectiveTo}
            onChange={(e) => setEffectiveTo(e.target.value)}
            className="input-field"
          />
        </Field>
      </div>

      <Field label="Notes / comments">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Anything you want to remember about this card — caveats, assumptions, who supplied it…"
          className="input-field resize-y"
        />
      </Field>

      <div className="border-t border-tac-border pt-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h4 className="font-semibold text-sm">Rate lines</h4>
            <p className="text-xs text-tac-muted mt-0.5">
              CSV/Excel parsed locally. PDF or image runs through Claude — review the rows
              before saving.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={downloadTemplate}
              className="text-xs text-tac-accent hover:text-tac-accent-hover underline"
            >
              download CSV template
            </button>
            <label
              className={`text-sm border border-tac-border px-3 py-1.5 rounded hover:border-tac-accent cursor-pointer ${
                parsing ? "opacity-60 pointer-events-none" : ""
              }`}
            >
              {parsing === "ai"
                ? "Extracting…"
                : parsing === "excel"
                ? "Reading Excel…"
                : parsing === "csv"
                ? "Reading CSV…"
                : "Upload file"}
              <input
                type="file"
                accept=".csv,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp,.gif"
                className="hidden"
                disabled={!!parsing}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              type="button"
              onClick={addBlankDraft}
              className="text-sm border border-tac-border px-3 py-1.5 rounded hover:border-tac-accent"
            >
              + Add row
            </button>
          </div>
        </div>

        {parseError && (
          <div className="rounded border border-tac-danger/40 bg-tac-danger/10 px-3 py-2 text-sm text-tac-danger">
            {parseError}
          </div>
        )}

        {parseWarnings.length > 0 && (
          <div className="rounded border border-tac-warning/40 bg-tac-warning/10 px-3 py-2 text-sm text-tac-warning space-y-1">
            <p className="font-medium">
              Heads up{lastFileName ? ` (${lastFileName})` : ""}:
            </p>
            <ul className="list-disc pl-5 text-xs">
              {parseWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {drafts.length === 0 ? (
          <div className="text-sm text-tac-muted italic border border-dashed border-tac-border rounded px-3 py-4">
            No rate lines yet. Upload a CSV, Excel, PDF, or image — or add rows manually.
          </div>
        ) : (
          <DraftLinesTable
            drafts={drafts}
            updateDraft={updateDraft}
            removeDraft={removeDraft}
          />
        )}
      </div>

      {submitError && (
        <div className="rounded border border-tac-danger/40 bg-tac-danger/10 px-3 py-2 text-sm text-tac-danger">
          {submitError}
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-tac-border pt-4">
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="px-4 py-2 rounded text-sm text-tac-muted hover:text-tac-text"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit || submitting}
          className="bg-tac-accent text-tac-bg font-semibold px-5 py-2 rounded hover:bg-tac-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Saving…" : `Save ${drafts.length} line${drafts.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}

function DraftLinesTable({
  drafts,
  updateDraft,
  removeDraft,
}: {
  drafts: DraftLine[];
  updateDraft: (id: string, patch: Partial<DraftLine>) => void;
  removeDraft: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-tac-muted border-b border-tac-border">
            <Th>Zone *</Th>
            <Th>Description</Th>
            <Th right>Min kg</Th>
            <Th right>Max kg</Th>
            <Th>Basis</Th>
            <Th right>Rate *</Th>
            <Th right>Per kg</Th>
            <Th right>Min $</Th>
            <Th>Notes</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {drafts.map((d) => (
            <tr key={d.__id} className="border-b border-tac-border/60">
              <TdInput
                value={d.zone_label}
                onChange={(v) => updateDraft(d.__id, { zone_label: v })}
              />
              <TdInput
                value={d.zone_description ?? ""}
                onChange={(v) => updateDraft(d.__id, { zone_description: v })}
              />
              <TdInput
                value={d.weight_min_kg ?? ""}
                type="number"
                onChange={(v) =>
                  updateDraft(d.__id, { weight_min_kg: v === "" ? null : Number(v) })
                }
                right
              />
              <TdInput
                value={d.weight_max_kg ?? ""}
                type="number"
                onChange={(v) =>
                  updateDraft(d.__id, { weight_max_kg: v === "" ? null : Number(v) })
                }
                right
              />
              <td className="px-2 py-1">
                <select
                  value={d.rate_basis}
                  onChange={(e) =>
                    updateDraft(d.__id, { rate_basis: e.target.value as RateBasis })
                  }
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
                value={d.rate_aud}
                type="number"
                onChange={(v) =>
                  updateDraft(d.__id, { rate_aud: v === "" ? 0 : Number(v) })
                }
                right
              />
              <TdInput
                value={d.per_kg_rate_aud ?? ""}
                type="number"
                onChange={(v) =>
                  updateDraft(d.__id, { per_kg_rate_aud: v === "" ? null : Number(v) })
                }
                right
              />
              <TdInput
                value={d.minimum_charge_aud ?? ""}
                type="number"
                onChange={(v) =>
                  updateDraft(d.__id, { minimum_charge_aud: v === "" ? null : Number(v) })
                }
                right
              />
              <TdInput
                value={d.notes ?? ""}
                onChange={(v) => updateDraft(d.__id, { notes: v })}
              />
              <td className="px-2 py-1">
                <button
                  type="button"
                  onClick={() => removeDraft(d.__id)}
                  className="text-xs text-tac-danger hover:underline"
                >
                  remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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

function detectFileKind(file: File): "csv" | "excel" | "ai" | null {
  const name = file.name.toLowerCase();
  const mime = file.type.toLowerCase();
  if (mime === "text/csv" || name.endsWith(".csv")) return "csv";
  if (
    mime.includes("spreadsheetml") ||
    mime === "application/vnd.ms-excel" ||
    name.endsWith(".xlsx") ||
    name.endsWith(".xls")
  )
    return "excel";
  if (
    mime === "application/pdf" ||
    mime.startsWith("image/") ||
    /\.(pdf|png|jpe?g|webp|gif)$/.test(name)
  )
    return "ai";
  return null;
}

function mapCsvRow(row: Record<string, string>, idx: number): DraftLine | null {
  const get = (key: string): string => {
    const found = Object.entries(row).find(
      ([k]) => k.trim().toLowerCase() === key.toLowerCase()
    );
    return (found?.[1] ?? "").trim();
  };

  const zone = get("Zone") || get("Zone Label") || get("zone_label");
  if (!zone) return null;

  const rateRaw = get("Rate (AUD)") || get("Rate") || get("rate_aud");
  const rate = Number(rateRaw);
  if (!Number.isFinite(rate)) return null;

  const basisRaw = (get("Rate Basis") || get("rate_basis") || "per_parcel").toLowerCase();
  const basis: RateBasis =
    basisRaw === "per_kg"
      ? "per_kg"
      : basisRaw === "per_parcel_plus_per_kg" || basisRaw === "per_parcel + per kg"
      ? "per_parcel_plus_per_kg"
      : "per_parcel";

  const num = (raw: string): number | null => {
    const v = Number(raw);
    return Number.isFinite(v) && raw !== "" ? v : null;
  };

  return {
    __id: `csv-${idx}-${crypto.randomUUID()}`,
    zone_label: zone,
    zone_description: get("Zone Description") || null,
    weight_min_kg: num(get("Weight Min (kg)") || get("weight_min_kg")),
    weight_max_kg: num(get("Weight Max (kg)") || get("weight_max_kg")),
    rate_basis: basis,
    rate_aud: rate,
    per_kg_rate_aud: num(get("Per kg Rate (AUD)") || get("per_kg_rate_aud")),
    minimum_charge_aud: num(get("Minimum Charge (AUD)") || get("minimum_charge_aud")),
    notes: get("Notes") || null,
  };
}
