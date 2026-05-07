"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Papa from "papaparse";
import type {
  Carrier,
  FreightShipmentVolumeWithCarrier,
} from "@/lib/db/types";
import type { ShipmentVolumeInput } from "@/lib/actions/shipment-volumes";

interface Props {
  tenantId: string | null;
}

interface DraftRow {
  carrierMatch: Carrier | null;
  carrierRaw: string;
  service_level: string;
  zone_label: string;
  monthly_shipments: number;
  avg_charge_aud: number;
  avg_weight_kg: number | null;
  notes: string;
}

const TEMPLATE_HEADERS = [
  "Carrier",
  "Service",
  "Zone",
  "Monthly Shipments",
  "Avg Charge (AUD)",
  "Avg Weight (kg)",
  "Notes",
];

export default function BillingTab({ tenantId }: Props) {
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [volumes, setVolumes] = useState<FreightShipmentVolumeWithCarrier[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [periodLabel, setPeriodLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const matchCarrier = useCallback(
    (raw: string, list: Carrier[]): Carrier | null => {
      const norm = raw.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!norm) return null;
      return (
        list.find(
          (c) =>
            c.code.toLowerCase().replace(/[^a-z0-9]/g, "") === norm ||
            c.name.toLowerCase().replace(/[^a-z0-9]/g, "") === norm
        ) ??
        list.find((c) =>
          c.name.toLowerCase().replace(/[^a-z0-9]/g, "").includes(norm)
        ) ??
        null
      );
    },
    []
  );

  const refreshVolumes = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/shipment-volumes?tenant_id=${id}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Failed to load");
        setVolumes(await res.json());
      } catch (e: unknown) {
        setLoadError(e instanceof Error ? e.message : "Unknown error");
      }
    },
    []
  );

  useEffect(() => {
    fetch("/api/carriers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Carrier[]) => setCarriers(d))
      .catch(() => setCarriers([]));
  }, []);

  useEffect(() => {
    if (!tenantId) {
      setVolumes([]);
      return;
    }
    refreshVolumes(tenantId);
  }, [tenantId, refreshVolumes]);

  const handleFile = (file: File) => {
    setParseError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        try {
          const parsed = parseCsvRows(result.data, carriers, matchCarrier);
          if (parsed.length === 0) {
            setParseError("No valid rows found. Check your column headers.");
            return;
          }
          setDrafts(parsed);
        } catch (e: unknown) {
          setParseError(e instanceof Error ? e.message : "Parse error");
        }
      },
      error: (err) => setParseError(err.message),
    });
  };

  const updateDraft = (i: number, patch: Partial<DraftRow>) => {
    setDrafts((d) => d.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  };

  const removeDraft = (i: number) => {
    setDrafts((d) => d.filter((_, idx) => idx !== i));
  };

  const allResolved = useMemo(
    () =>
      drafts.length > 0 &&
      drafts.every(
        (d) =>
          d.carrierMatch &&
          d.service_level.trim() &&
          d.zone_label.trim() &&
          d.monthly_shipments >= 0 &&
          d.avg_charge_aud >= 0
      ),
    [drafts]
  );

  const totals = useMemo(() => {
    const shipments = drafts.reduce((s, d) => s + (d.monthly_shipments || 0), 0);
    const spend = drafts.reduce(
      (s, d) => s + (d.monthly_shipments || 0) * (d.avg_charge_aud || 0),
      0
    );
    return { shipments, spend };
  }, [drafts]);

  const handleCommit = async () => {
    if (!tenantId || !allResolved) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const rows: ShipmentVolumeInput[] = drafts.map((d) => ({
        tenant_id: tenantId,
        carrier_id: d.carrierMatch!.id,
        service_level: d.service_level,
        zone_label: d.zone_label,
        monthly_shipments: d.monthly_shipments,
        avg_charge_aud: d.avg_charge_aud,
        avg_weight_kg: d.avg_weight_kg,
        period_label: periodLabel.trim() || null,
        source: "manual_csv",
      }));
      const res = await fetch("/api/shipment-volumes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
      setDrafts([]);
      setPeriodLabel("");
      await refreshVolumes(tenantId);
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteRow = async (id: string) => {
    if (!tenantId) return;
    try {
      const res = await fetch(`/api/shipment-volumes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      await refreshVolumes(tenantId);
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "Unknown error");
    }
  };

  const downloadTemplate = () => {
    const csv = [
      TEMPLATE_HEADERS.join(","),
      "Australia Post,Standard,Metro,1200,9.85,0.8,",
      "Australia Post,Express,Metro,300,14.20,0.8,",
      "StarTrack,Premium,Regional,150,18.50,1.2,",
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "shipment-volumes-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!tenantId) {
    return (
      <div className="card text-center py-12 border-dashed">
        <p className="text-tac-muted">Select a tenant to enter current volume + charges.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-start justify-between mb-4 gap-4">
          <div>
            <h2 className="text-xl font-semibold mb-1">Upload Current Volume + Charges</h2>
            <p className="text-sm text-tac-muted">
              CSV columns:{" "}
              <code className="text-xs bg-tac-bg-light px-1.5 py-0.5 rounded">
                Carrier, Service, Zone, Monthly Shipments, Avg Charge (AUD), Avg Weight (kg), Notes
              </code>
            </p>
          </div>
          <button
            type="button"
            onClick={downloadTemplate}
            className="text-sm text-tac-accent hover:underline whitespace-nowrap"
          >
            ↓ Template
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-xs text-tac-muted block mb-1">CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
              className="block w-full text-sm text-tac-text file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-tac-accent file:text-tac-bg hover:file:bg-tac-accent/90"
            />
          </label>
          <label className="block">
            <span className="text-xs text-tac-muted block mb-1">Period label (optional)</span>
            <input
              type="text"
              value={periodLabel}
              onChange={(e) => setPeriodLabel(e.target.value)}
              placeholder="e.g. Mar 2026, Q1 2026, FY26 avg"
              className="input-field w-full"
            />
          </label>
        </div>

        {parseError && <p className="text-sm text-tac-danger mt-3">{parseError}</p>}
      </div>

      {drafts.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-tac-accent">
                Review {drafts.length} {drafts.length === 1 ? "row" : "rows"}
              </h3>
              <p className="text-xs text-tac-muted">
                Confirm carrier matches and edit any field before committing.
              </p>
            </div>
            <div className="text-right text-xs text-tac-muted">
              <div>
                <span className="text-tac-text font-semibold">
                  {totals.shipments.toLocaleString()}
                </span>{" "}
                shipments / mo
              </div>
              <div>
                <span className="text-tac-text font-semibold">
                  ${totals.spend.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>{" "}
                spend / mo
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-tac-border text-tac-muted">
                  <th className="text-left py-2 px-2">Carrier</th>
                  <th className="text-left py-2 px-2">Service</th>
                  <th className="text-left py-2 px-2">Zone</th>
                  <th className="text-right py-2 px-2">Shipments/mo</th>
                  <th className="text-right py-2 px-2">Avg Charge</th>
                  <th className="text-right py-2 px-2">Avg Weight</th>
                  <th className="py-2 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d, i) => (
                  <tr key={i} className="border-b border-tac-border/50">
                    <td className="py-1.5 px-2 min-w-[180px]">
                      <select
                        value={d.carrierMatch?.id ?? ""}
                        onChange={(e) => {
                          const c = carriers.find((x) => x.id === e.target.value) ?? null;
                          updateDraft(i, { carrierMatch: c });
                        }}
                        className={`input-field text-sm py-1 w-full ${
                          d.carrierMatch ? "" : "border-tac-danger/50"
                        }`}
                      >
                        <option value="">— pick — ({d.carrierRaw})</option>
                        {carriers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1.5 px-2">
                      <input
                        type="text"
                        value={d.service_level}
                        onChange={(e) => updateDraft(i, { service_level: e.target.value })}
                        className="input-field text-sm py-1 w-full"
                      />
                    </td>
                    <td className="py-1.5 px-2">
                      <input
                        type="text"
                        value={d.zone_label}
                        onChange={(e) => updateDraft(i, { zone_label: e.target.value })}
                        className="input-field text-sm py-1 w-full"
                      />
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      <input
                        type="number"
                        value={d.monthly_shipments}
                        onChange={(e) =>
                          updateDraft(i, {
                            monthly_shipments: parseFloat(e.target.value) || 0,
                          })
                        }
                        step="1"
                        min="0"
                        className="input-field text-sm py-1 w-24 text-right"
                      />
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      <input
                        type="number"
                        value={d.avg_charge_aud}
                        onChange={(e) =>
                          updateDraft(i, {
                            avg_charge_aud: parseFloat(e.target.value) || 0,
                          })
                        }
                        step="0.01"
                        min="0"
                        className="input-field text-sm py-1 w-24 text-right"
                      />
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      <input
                        type="number"
                        value={d.avg_weight_kg ?? ""}
                        onChange={(e) =>
                          updateDraft(i, {
                            avg_weight_kg:
                              e.target.value === "" ? null : parseFloat(e.target.value),
                          })
                        }
                        step="0.1"
                        min="0"
                        placeholder="—"
                        className="input-field text-sm py-1 w-20 text-right"
                      />
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeDraft(i)}
                        className="text-tac-muted hover:text-tac-danger text-xs"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {submitError && <p className="text-sm text-tac-danger mt-3">{submitError}</p>}

          <div className="flex justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={() => setDrafts([])}
              className="px-4 py-2 rounded-lg border border-tac-border text-tac-muted hover:text-tac-text"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={handleCommit}
              disabled={!allResolved || submitting}
              className="px-4 py-2 rounded-lg bg-tac-accent text-tac-bg font-medium disabled:opacity-50"
            >
              {submitting ? "Saving…" : `Commit ${drafts.length} rows`}
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">
            Saved Volumes{" "}
            <span className="text-xs text-tac-muted font-normal">({volumes.length})</span>
          </h3>
        </div>

        {loadError && <p className="text-sm text-tac-danger mb-3">{loadError}</p>}

        {volumes.length === 0 ? (
          <p className="text-sm text-tac-muted py-6 text-center">
            No volume data yet. Upload a CSV above to get started.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-tac-border text-tac-muted">
                  <th className="text-left py-2 pr-3">Carrier</th>
                  <th className="text-left py-2 px-3">Service</th>
                  <th className="text-left py-2 px-3">Zone</th>
                  <th className="text-right py-2 px-3">Shipments/mo</th>
                  <th className="text-right py-2 px-3">Avg Charge</th>
                  <th className="text-right py-2 px-3">Spend/mo</th>
                  <th className="text-left py-2 px-3">Period</th>
                  <th className="py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {volumes.map((v) => (
                  <tr key={v.id} className="border-b border-tac-border/50">
                    <td className="py-2 pr-3 font-medium">{v.carrier.name}</td>
                    <td className="py-2 px-3">{v.service_level}</td>
                    <td className="py-2 px-3">{v.zone_label}</td>
                    <td className="py-2 px-3 text-right">
                      {v.monthly_shipments.toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-right">
                      ${v.avg_charge_aud.toFixed(2)}
                    </td>
                    <td className="py-2 px-3 text-right text-tac-accent font-semibold">
                      $
                      {(v.monthly_shipments * v.avg_charge_aud).toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                    </td>
                    <td className="py-2 px-3 text-tac-muted">{v.period_label ?? "—"}</td>
                    <td className="py-2 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleDeleteRow(v.id)}
                        className="text-tac-muted hover:text-tac-danger text-xs"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="text-tac-muted">
                  <td colSpan={3} className="py-2 pr-3 font-semibold">
                    Total
                  </td>
                  <td className="py-2 px-3 text-right font-semibold text-tac-text">
                    {volumes
                      .reduce((s, v) => s + v.monthly_shipments, 0)
                      .toLocaleString()}
                  </td>
                  <td></td>
                  <td className="py-2 px-3 text-right font-semibold text-tac-accent">
                    $
                    {volumes
                      .reduce((s, v) => s + v.monthly_shipments * v.avg_charge_aud, 0)
                      .toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function parseCsvRows(
  rows: Record<string, string>[],
  carriers: Carrier[],
  matchCarrier: (raw: string, list: Carrier[]) => Carrier | null
): DraftRow[] {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const findValue = (row: Record<string, string>, candidates: string[]): string => {
    const keys = Object.keys(row);
    for (const c of candidates) {
      const target = norm(c);
      const k = keys.find((key) => norm(key) === target);
      if (k && row[k] !== undefined) return row[k];
    }
    return "";
  };

  return rows
    .map((row): DraftRow | null => {
      const carrierRaw = findValue(row, ["Carrier", "carrier", "Carrier Name"]);
      const service = findValue(row, ["Service", "Service Level", "service"]);
      const zone = findValue(row, ["Zone", "zone", "Zone Label"]);
      const shipments = parseFloat(
        findValue(row, ["Monthly Shipments", "Shipments", "Volume", "Monthly Volume"]) || "0"
      );
      const charge = parseFloat(
        findValue(row, [
          "Avg Charge (AUD)",
          "Avg Charge",
          "Average Charge",
          "Avg Cost",
          "Charge",
        ]) || "0"
      );
      const weight = findValue(row, ["Avg Weight (kg)", "Avg Weight", "Weight"]);
      const notes = findValue(row, ["Notes", "Note", "notes"]);

      if (!carrierRaw && !service && !zone) return null;

      return {
        carrierRaw: carrierRaw || "(unknown)",
        carrierMatch: matchCarrier(carrierRaw, carriers),
        service_level: service.trim(),
        zone_label: zone.trim(),
        monthly_shipments: Number.isFinite(shipments) ? shipments : 0,
        avg_charge_aud: Number.isFinite(charge) ? charge : 0,
        avg_weight_kg: weight ? parseFloat(weight) || null : null,
        notes: notes.trim(),
      };
    })
    .filter((r): r is DraftRow => r !== null);
}
