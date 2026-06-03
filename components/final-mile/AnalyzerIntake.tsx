"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ThinkingIndicator from "@/components/shared/ThinkingIndicator";
import type { AnalysisBrief, FuelMode } from "@/lib/analyzer/report-types";

interface CarrierLite {
  code: string;
  name: string;
  monthly_shipments: number;
}

interface ServiceTierPairLite {
  volume_carrier_code: string;
  volume_carrier_name: string;
  volume_service_level: string;
  monthly_shipments: number;
  monthly_spend_aud: number;
}

interface RateCardLite {
  id: string;
  carrier_code: string;
  carrier_name: string;
  service_level: string;
  label: string | null;
  effective_from: string | null;
  fuel_surcharge_percent: number | null;
}

interface IntakeOptions {
  default_period_label: string | null;
  carriers_in_volumes: CarrierLite[];
  service_tier_pairs: ServiceTierPairLite[];
  new_rate_cards: RateCardLite[];
  total_monthly_shipments: number;
  total_monthly_spend_aud: number;
}

interface AnalyzerIntakeProps {
  tenantId: string;
}

const FUEL_MODES: { value: FuelMode; title: string; help: string }[] = [
  {
    value: "base",
    title: "Base only",
    help: "Strip fuel and surcharges. Fairest like-for-like across carriers.",
  },
  {
    value: "with_fuel",
    title: "Base + fuel",
    help: "Apply each carrier's fuel surcharge %. Recommended default.",
  },
  {
    value: "with_all_surcharges",
    title: "All surcharges",
    help: "Fuel + residential + remote + handling. Closest to invoice reality.",
  },
];

export default function AnalyzerIntake({ tenantId }: AnalyzerIntakeProps) {
  const [options, setOptions] = useState<IntakeOptions | null>(null);
  const [completedAnalysisId, setCompletedAnalysisId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const [periodLabel, setPeriodLabel] = useState("");
  const [density, setDensity] = useState(250);
  const [residential, setResidential] = useState(75);
  const [fuelMode, setFuelMode] = useState<FuelMode>("with_fuel");
  const [perCarrierFuel, setPerCarrierFuel] = useState<
    Record<string, { enabled: boolean; pct: number; note: string }>
  >({});
  const [tierOverrides, setTierOverrides] = useState<
    Record<string, { rate_card_id: string }>
  >({});
  const [notes, setNotes] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setOptions(null);
    fetch(`/api/analyzer/intake-options?tenant_id=${encodeURIComponent(tenantId)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to load intake options (${res.status})`);
        }
        return (await res.json()) as IntakeOptions;
      })
      .then((data) => {
        if (cancelled) return;
        setOptions(data);
        setPeriodLabel(data.default_period_label ?? defaultPeriodLabel());
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Failed to load intake options");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const tierKey = useCallback(
    (p: ServiceTierPairLite) => `${p.volume_carrier_code}::${p.volume_service_level}`,
    []
  );

  const replacementOptionsForTier = useCallback(
    (pair: ServiceTierPairLite, available: RateCardLite[]): RateCardLite[] => {
      const sameTier = available.filter(
        (c) =>
          c.service_level.toLowerCase().trim() ===
          pair.volume_service_level.toLowerCase().trim()
      );
      if (sameTier.length > 0) return sameTier;
      return available;
    },
    []
  );

  const brief: AnalysisBrief = useMemo(() => {
    const fuelOverrides: AnalysisBrief["per_carrier_fuel_overrides"] = [];
    for (const [code, entry] of Object.entries(perCarrierFuel)) {
      if (!entry.enabled) continue;
      if (!Number.isFinite(entry.pct)) continue;
      fuelOverrides.push({
        carrier_code: code,
        fuel_pct: entry.pct,
        note: entry.note.trim() || null,
      });
    }

    const tierOv: AnalysisBrief["service_tier_pair_overrides"] = [];
    for (const [key, entry] of Object.entries(tierOverrides)) {
      const [code, level] = key.split("::");
      if (!code || !level) continue;
      tierOv.push({
        volume_carrier_code: code,
        volume_service_level: level,
        chosen_replacement_rate_card_id: entry.rate_card_id || null,
      });
    }

    return {
      period_label: periodLabel.trim() || defaultPeriodLabel(),
      density_kg_per_m3: density,
      residential_mix_pct: residential,
      default_fuel_mode: fuelMode,
      per_carrier_fuel_overrides: fuelOverrides,
      service_tier_pair_overrides: tierOv,
      notes: notes.trim() || null,
    };
  }, [periodLabel, density, residential, fuelMode, perCarrierFuel, tierOverrides, notes]);

  const validation = useMemo(() => {
    const issues: string[] = [];
    if (density < 50 || density > 1000) issues.push("Density should be between 50 and 1000 kg/m³.");
    if (residential < 0 || residential > 100)
      issues.push("Residential mix must be 0–100%.");
    for (const [code, entry] of Object.entries(perCarrierFuel)) {
      if (entry.enabled && (entry.pct < 0 || entry.pct > 100)) {
        issues.push(`Fuel surcharge for ${code} must be 0–100%.`);
      }
    }
    return issues;
  }, [density, residential, perCarrierFuel]);

  const execute = useCallback(async () => {
    if (executing) return;
    if (validation.length > 0) {
      setRunError(validation.join(" "));
      return;
    }
    setExecuting(true);
    setRunError(null);
    setCompletedAnalysisId(null);
    try {
      const res = await fetch("/api/analyzer/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, brief }),
      });
      const body = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !body.id) {
        throw new Error(body.error || `Analysis failed (${res.status})`);
      }
      const reportUrl = `/final-mile/analyzer/report/${body.id}`;
      setCompletedAnalysisId(body.id);
      // Hard browser navigation — bypasses any router/state issues that
      // silently swallow a push after a long-running fetch.
      window.location.assign(reportUrl);
    } catch (e: unknown) {
      setRunError(e instanceof Error ? e.message : "Analysis failed");
      setExecuting(false);
    }
  }, [executing, validation, tenantId, brief]);

  if (loading) {
    return (
      <div className="card">
        <ThinkingIndicator kind="analyze" />
        <p className="text-tac-muted text-sm mt-3">Loading carriers and rate cards…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="card border-tac-danger/40 bg-tac-danger/10 text-sm text-tac-danger">
        {loadError}
      </div>
    );
  }

  if (!options) return null;

  const hasData =
    options.carriers_in_volumes.length > 0 && options.new_rate_cards.length > 0;

  if (!hasData) {
    return (
      <div className="card border-tac-accent/40 bg-tac-accent/5 text-sm space-y-2">
        <p className="text-tac-text font-medium">Not enough data to analyse yet.</p>
        <p className="text-tac-muted">
          Load at least one current shipment volume CSV and one new rate card on the{" "}
          <a className="text-tac-accent hover:underline" href="/final-mile">
            rate cards page
          </a>{" "}
          before running the analyzer.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SnapshotSummary options={options} />

      <Section
        title="Period & assumptions"
        subtitle="The basic frame for the analysis. Defaults are sensible for AU ecom — change only if you know the lane mix."
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Period label" hint="What window are these volumes from?">
            <input
              type="text"
              value={periodLabel}
              onChange={(e) => setPeriodLabel(e.target.value)}
              placeholder="e.g. October 2025"
              className="input-field"
            />
          </Field>
          <Field
            label="Density (kg/m³)"
            hint="Used to convert volume → cubic. 250 ≈ light apparel, 350+ ≈ shoes/grocery."
          >
            <input
              type="number"
              value={density}
              min={50}
              max={1000}
              step={10}
              onChange={(e) => setDensity(Number(e.target.value))}
              className="input-field"
            />
          </Field>
          <Field
            label="Residential mix (%)"
            hint="Share of B2C destinations. Drives residential surcharge weighting."
          >
            <input
              type="number"
              value={residential}
              min={0}
              max={100}
              step={5}
              onChange={(e) => setResidential(Number(e.target.value))}
              className="input-field"
            />
          </Field>
        </div>

        <Field
          label="Default fuel view"
          hint="The fuel mode the report opens on. The other two are still computed and shown in the toggle."
        >
          <div className="grid sm:grid-cols-3 gap-2">
            {FUEL_MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setFuelMode(m.value)}
                className={`text-left rounded border px-3 py-2.5 text-sm transition-colors ${
                  fuelMode === m.value
                    ? "border-tac-accent bg-tac-accent/10"
                    : "border-tac-border hover:border-tac-accent/60"
                }`}
              >
                <div className="font-medium">{m.title}</div>
                <div className="text-xs text-tac-muted mt-0.5">{m.help}</div>
              </button>
            ))}
          </div>
        </Field>
      </Section>

      <Section
        title="Service-tier replacement"
        subtitle="For each lane in your volumes, choose which new rate card represents the equivalent service. Auto-matched on service level — change only if the auto-match is wrong."
      >
        {options.service_tier_pairs.length === 0 ? (
          <Empty>No carrier × service pairs detected in volumes.</Empty>
        ) : (
          <div className="space-y-2">
            {options.service_tier_pairs.map((pair) => {
              const key = tierKey(pair);
              const replacements = replacementOptionsForTier(pair, options.new_rate_cards);
              const current = tierOverrides[key]?.rate_card_id ?? "";
              return (
                <div
                  key={key}
                  className="grid sm:grid-cols-[1fr_2fr] gap-3 items-center rounded border border-tac-border bg-tac-bg-card/40 px-3 py-2.5"
                >
                  <div className="text-sm">
                    <div className="font-medium">
                      {pair.volume_carrier_name}{" "}
                      <span className="text-tac-muted">/ {pair.volume_service_level}</span>
                    </div>
                    <div className="text-xs text-tac-muted">
                      {pair.monthly_shipments.toLocaleString()} shp/mo ·{" "}
                      {fmtAud(pair.monthly_spend_aud)}/mo
                    </div>
                  </div>
                  <select
                    value={current}
                    onChange={(e) =>
                      setTierOverrides((prev) => ({
                        ...prev,
                        [key]: { rate_card_id: e.target.value },
                      }))
                    }
                    className="input-field"
                  >
                    <option value="">Auto (engine picks best service-tier match)</option>
                    {replacements.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.carrier_name} · {c.service_level}
                        {c.label ? ` · ${c.label}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section
        title="Advanced overrides"
        subtitle="Per-carrier fuel and freeform notes. Only open this if you have specific knowledge that overrides the rate card metadata."
      >
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-sm text-tac-accent hover:underline"
        >
          {showAdvanced ? "Hide advanced overrides" : "Show advanced overrides"}
        </button>

        {showAdvanced && (
          <div className="space-y-4 mt-4">
            <div>
              <h4 className="text-sm font-medium mb-2">Per-carrier fuel surcharge override</h4>
              <p className="text-xs text-tac-muted mb-3">
                Use this when you have a negotiated fuel % that differs from the rate card metadata.
                Leave disabled to use the rate card&apos;s declared fuel.
              </p>
              <div className="space-y-2">
                {options.carriers_in_volumes.map((c) => {
                  const entry = perCarrierFuel[c.code] ?? {
                    enabled: false,
                    pct: 8,
                    note: "",
                  };
                  return (
                    <div
                      key={c.code}
                      className="grid sm:grid-cols-[auto_1fr_auto_2fr] gap-2 items-center rounded border border-tac-border bg-tac-bg-card/40 px-3 py-2"
                    >
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={entry.enabled}
                          onChange={(e) =>
                            setPerCarrierFuel((prev) => ({
                              ...prev,
                              [c.code]: { ...entry, enabled: e.target.checked },
                            }))
                          }
                        />
                        <span className="font-medium">{c.name}</span>
                      </label>
                      <span className="text-xs text-tac-muted">
                        {c.monthly_shipments.toLocaleString()} shp/mo
                      </span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step={0.5}
                          min={0}
                          max={100}
                          value={entry.pct}
                          disabled={!entry.enabled}
                          onChange={(e) =>
                            setPerCarrierFuel((prev) => ({
                              ...prev,
                              [c.code]: { ...entry, pct: Number(e.target.value) },
                            }))
                          }
                          className="input-field w-20"
                        />
                        <span className="text-xs text-tac-muted">%</span>
                      </div>
                      <input
                        type="text"
                        placeholder="Optional note (e.g. Q4 negotiated rate)"
                        value={entry.note}
                        disabled={!entry.enabled}
                        onChange={(e) =>
                          setPerCarrierFuel((prev) => ({
                            ...prev,
                            [c.code]: { ...entry, note: e.target.value },
                          }))
                        }
                        className="input-field"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <Field
              label="Notes for the analyst"
              hint="Anything the engine should know but can't see in the data — pricing context, upcoming volume shifts, etc."
            >
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Volume includes a one-off Black Friday spike — please flag if anomalies appear."
                className="input-field resize-none"
              />
            </Field>
          </div>
        )}
      </Section>

      {validation.length > 0 && (
        <div className="rounded border border-tac-warning/40 bg-tac-warning/10 px-3 py-2 text-sm text-tac-warning space-y-1">
          {validation.map((v) => (
            <div key={v}>{v}</div>
          ))}
        </div>
      )}

      {runError && (
        <div className="rounded border border-tac-danger/40 bg-tac-danger/10 px-3 py-2 text-sm text-tac-danger">
          {runError}
        </div>
      )}

      <div className="flex items-center justify-between gap-4 sticky bottom-0 bg-tac-bg/90 backdrop-blur py-3 border-t border-tac-border">
        <p className="text-xs text-tac-muted">
          The engine computes the math; Claude only writes the prose. Numbers are deterministic and
          will always reconcile.
        </p>
        <button
          type="button"
          onClick={execute}
          disabled={executing || validation.length > 0}
          className="bg-tac-accent text-tac-bg font-semibold px-5 py-2.5 rounded hover:bg-tac-accent-hover disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {executing ? "Running…" : "Execute analysis →"}
        </button>
      </div>

      {executing && (
        <div className="card">
          <ThinkingIndicator kind="analyze" />
          <p className="text-tac-muted text-sm mt-3">
            Running deterministic engine, narrative pass, and adversarial critic…
          </p>
          <p className="text-tac-muted text-xs mt-1">
            Typically 2–3 minutes. Keep this tab open — you&apos;ll be redirected to the report when it&apos;s ready.
          </p>
          {completedAnalysisId && (
            <p className="text-tac-muted text-xs mt-3">
              Done. If you&apos;re not redirected automatically,{" "}
              <a
                href={`/final-mile/analyzer/report/${completedAnalysisId}`}
                className="text-tac-accent hover:underline font-medium"
              >
                open the report
              </a>
              .
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface SnapshotSummaryProps {
  options: IntakeOptions;
}

function SnapshotSummary({ options }: SnapshotSummaryProps) {
  return (
    <div className="grid sm:grid-cols-3 gap-3">
      <SummaryStat
        label="Monthly shipments"
        value={options.total_monthly_shipments.toLocaleString()}
      />
      <SummaryStat
        label="Monthly spend"
        value={fmtAud(options.total_monthly_spend_aud)}
      />
      <SummaryStat
        label="New rate cards loaded"
        value={String(options.new_rate_cards.length)}
      />
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-tac-border bg-tac-bg-card/40 px-3 py-2.5">
      <div className="text-xs text-tac-muted">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card space-y-4">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        {subtitle && <p className="text-xs text-tac-muted mt-1">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-tac-text">{label}</span>
      {children}
      {hint && <span className="block text-xs text-tac-muted">{hint}</span>}
    </label>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-tac-muted italic">{children}</p>;
}

function defaultPeriodLabel(): string {
  const now = new Date();
  return now.toLocaleString("en-AU", { month: "long", year: "numeric" });
}

function fmtAud(n: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}
