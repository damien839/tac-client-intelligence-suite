"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Carrier } from "@/lib/db/types";

interface PostcodeBreakdownRow {
  postcode: string;
  resolved_zone: string;
  carrier_id: string;
  carrier_name: string | null;
  carrier_code: string | null;
  service_level: string | null;
  shipments: number;
  total_charge_aud: number;
  avg_charge_aud: number;
  avg_weight_kg: number | null;
}

interface Props {
  tenantId: string;
  carriers: Carrier[];
  /** bumped by parent after a successful billing extract */
  refreshKey?: number;
}

/**
 * Drill-down view of where the freight spend actually lands. Reads
 * `shipment_lines` via /api/shipment-volumes/postcode-breakdown and
 * surfaces the top spend postcodes — the answer to "which postcodes
 * drive the cost gap" once the analyzer flags one.
 */
export default function PostcodeBreakdownPanel({
  tenantId,
  carriers,
  refreshKey = 0,
}: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PostcodeBreakdownRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [carrierFilter, setCarrierFilter] = useState<string>("");
  const [limit, setLimit] = useState<number>(50);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        tenant_id: tenantId,
        limit: String(limit),
      });
      if (carrierFilter) params.set("carrier_id", carrierFilter);
      const res = await fetch(
        `/api/shipment-volumes/postcode-breakdown?${params.toString()}`,
        { cache: "no-store" }
      );
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      setRows(Array.isArray(body.rows) ? body.rows : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId, carrierFilter, limit]);

  // Auto-load when the panel opens or filters change. Also re-load when
  // the parent signals a fresh upload via refreshKey.
  useEffect(() => {
    if (open) void load();
  }, [open, load, refreshKey]);

  const totals = useMemo(() => {
    const shipments = rows.reduce((s, r) => s + r.shipments, 0);
    const spend = rows.reduce((s, r) => s + r.total_charge_aud, 0);
    return { shipments, spend, postcodes: new Set(rows.map((r) => r.postcode)).size };
  }, [rows]);

  return (
    <div className="card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full text-left"
      >
        <div>
          <h3 className="text-lg font-semibold">Postcode-level breakdown</h3>
          <p className="text-xs text-tac-muted mt-0.5">
            Per-shipment data, sorted by spend. Use this to find which
            destinations drive the cost gap.
          </p>
        </div>
        <span className="text-tac-muted text-sm">{open ? "▾ hide" : "▸ show"}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-3 items-end">
            <label className="block">
              <span className="text-xs text-tac-muted block mb-1">Carrier</span>
              <select
                value={carrierFilter}
                onChange={(e) => setCarrierFilter(e.target.value)}
                className="input-field text-sm py-1"
              >
                <option value="">All carriers</option>
                {carriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-tac-muted block mb-1">Top N</span>
              <select
                value={limit}
                onChange={(e) => setLimit(parseInt(e.target.value, 10))}
                className="input-field text-sm py-1"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={500}>500</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="btn-secondary text-sm py-1.5 px-3 disabled:opacity-50"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>

          {error && <p className="text-sm text-tac-danger">{error}</p>}

          {!error && rows.length === 0 && !loading && (
            <p className="text-sm text-tac-muted">
              No line-level data yet for this tenant. Upload a per-shipment
              billing export (TGE, AusPost APVOL, etc.) to populate this view.
            </p>
          )}

          {rows.length > 0 && (
            <>
              <div className="text-xs text-tac-muted">
                Showing{" "}
                <span className="text-tac-text font-semibold">{totals.postcodes}</span>{" "}
                postcodes ·{" "}
                <span className="text-tac-text font-semibold">
                  {totals.shipments.toLocaleString()}
                </span>{" "}
                shipments ·{" "}
                <span className="text-tac-text font-semibold">
                  ${totals.spend.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>{" "}
                spend
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-tac-border text-tac-muted">
                      <th className="text-left py-2 px-2">Postcode</th>
                      <th className="text-left py-2 px-2">Zone</th>
                      <th className="text-left py-2 px-2">Carrier</th>
                      <th className="text-left py-2 px-2">Service</th>
                      <th className="text-right py-2 px-2">Shipments</th>
                      <th className="text-right py-2 px-2">Avg charge</th>
                      <th className="text-right py-2 px-2">Avg weight</th>
                      <th className="text-right py-2 px-2">Total spend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={`${r.postcode}-${r.carrier_id}-${r.service_level ?? ""}`}
                        className="border-b border-tac-border/50"
                      >
                        <td className="py-1.5 px-2 font-mono">{r.postcode}</td>
                        <td className="py-1.5 px-2">{r.resolved_zone}</td>
                        <td className="py-1.5 px-2">{r.carrier_name ?? "—"}</td>
                        <td className="py-1.5 px-2">{r.service_level ?? "—"}</td>
                        <td className="py-1.5 px-2 text-right">
                          {r.shipments.toLocaleString()}
                        </td>
                        <td className="py-1.5 px-2 text-right">
                          ${r.avg_charge_aud.toFixed(2)}
                        </td>
                        <td className="py-1.5 px-2 text-right">
                          {r.avg_weight_kg == null
                            ? "—"
                            : `${r.avg_weight_kg.toFixed(2)} kg`}
                        </td>
                        <td className="py-1.5 px-2 text-right font-semibold">
                          $
                          {r.total_charge_aud.toLocaleString(undefined, {
                            maximumFractionDigits: 0,
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
