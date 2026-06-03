"use client";

import { useMemo, useState } from "react";

import type {
  AnalyzerReport,
  ContextConfirmation,
  CoverageGap,
  FuelMode,
  RegionBreakdownRow,
  ReviewCategory,
  ReviewFinding,
  ReviewResult,
  ServiceTierPair,
  SizeBreakRow,
  SpendComparisonRow,
  StateBreakdownRow,
  TopOpportunity,
  Warning,
  Recommendation,
} from "@/lib/analyzer/report-types";

import { CHART_GRID, CHART_TICK, TAC_PALETTE } from "./charts";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface ReportRendererProps {
  report: AnalyzerReport;
  generatedAt: string;
  analysisId: string;
}

export default function ReportRenderer({
  report,
  generatedAt,
  analysisId,
}: ReportRendererProps) {
  const [fuelMode, setFuelMode] = useState<FuelMode>(
    report.headline_savings.default_fuel_mode
  );

  const blockingWarnings = report.warnings.filter((w) => w.severity === "block");
  const warnWarnings = report.warnings.filter((w) => w.severity === "warn");
  const banner = useMemo(() => {
    if (report.report_state === "blocked") return "blocked" as const;
    if (report.report_state === "draft_only") return "draft" as const;
    return null;
  }, [report.report_state]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 space-y-12">
      {banner === "blocked" && <BlockedBanner blockers={blockingWarnings} />}
      {banner === "draft" && <DraftBanner blockers={blockingWarnings} warns={warnWarnings} />}

      <ReadinessBanner review={report.review} />

      <Header report={report} generatedAt={generatedAt} analysisId={analysisId} />

      {report.context_confirmation && (
        <Section
          title="Context & approach"
          subtitle="What was analysed, against what, and how — confirm scope before reading the numbers."
        >
          <ContextBlock
            context={report.context_confirmation}
            analystSummary={report.analyst_summary}
          />
        </Section>
      )}

      <Section
        title="Analyst review"
        subtitle="Adversarial critic findings — surfaced before the numbers so the consultant can brief themselves and address objections proactively."
      >
        <ReviewPanel review={report.review} />
      </Section>

      <Section
        title="Headline savings"
        subtitle={report.headline_savings.framing}
      >
        <FuelToggle current={fuelMode} onChange={setFuelMode} />
        <HeadlineCards report={report} fuelMode={fuelMode} />
        <SensitivityStrip report={report} />
      </Section>

      <Section
        title="Spend comparison"
        subtitle="Grouped by carrier × service level. Expand a group to see per-zone lanes. Negative delta = savings."
      >
        <SpendAccordion
          rows={report.spend_comparison.table}
          currency={report.header.currency}
        />
      </Section>

      <Section
        title="Drill-down"
        subtitle={`State → region → carrier-zone → size breaks. Unmapped: ${report.drilldown.unmapped_state_pct.toFixed(1)}% of volume.`}
      >
        <DrillDownTabs report={report} />
      </Section>

      <Section
        title="Top opportunities"
        subtitle="Lanes with the largest annual savings, ranked by impact."
      >
        <OpportunityCards opportunities={report.top_opportunities} />
      </Section>

      <Section
        title="Service-tier pairs"
        subtitle="Same-tier replacements only. Gaps surface as exposure, never substituted."
      >
        <ServiceTierTable pairs={report.service_tier_pairs} />
      </Section>

      {report.coverage_gaps.length > 0 && (
        <Section
          title="Replacement carrier footprint"
          subtitle="Where each replacement carrier serves. Australia Post is the universal baseline; other carriers serve a subset of postcodes by design — not a problem, just the comparison set."
        >
          <CoverageTable gaps={report.coverage_gaps} />
        </Section>
      )}

      <Section title="Recommendations">
        <RecommendationList recs={report.recommendations} />
      </Section>

      {report.warnings.length > 0 && (
        <Section title="Warnings">
          <WarningsList warnings={report.warnings} />
        </Section>
      )}

      <Section title="Methodology">
        <MethodologyBlock report={report} />
      </Section>
    </div>
  );
}

function FuelToggle({
  current,
  onChange,
}: {
  current: FuelMode;
  onChange: (mode: FuelMode) => void;
}) {
  const options: { mode: FuelMode; label: string }[] = [
    { mode: "base", label: "Base only" },
    { mode: "with_fuel", label: "Base + fuel" },
    { mode: "with_all_surcharges", label: "All surcharges" },
  ];
  return (
    <div className="inline-flex rounded-md overflow-hidden border border-tac-border mb-4">
      {options.map((o) => (
        <button
          key={o.mode}
          onClick={() => onChange(o.mode)}
          className={`px-3 py-1.5 text-xs font-medium transition ${
            current === o.mode
              ? "bg-tac-danger text-white"
              : "bg-transparent text-tac-muted hover:text-white"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Header({
  report,
  generatedAt,
  analysisId,
}: {
  report: AnalyzerReport;
  generatedAt: string;
  analysisId: string;
}) {
  return (
    <div className="card-elevated flex flex-col md:flex-row md:items-center md:justify-between gap-6">
      <div>
        <div className="text-[11px] uppercase tracking-[0.1em] text-tac-accent/80 font-medium">
          {report.header.tenant_kind} · {report.header.period_label}
        </div>
        <h1 className="font-poppins text-3xl font-semibold tracking-tight text-white mt-1">
          {report.header.tenant_name}
        </h1>
        <div className="text-sm text-tac-muted mt-2 flex flex-wrap items-baseline gap-x-3">
          <span>
            <span className="num text-white">
              {report.header.total_monthly_shipments.toLocaleString()}
            </span>{" "}
            parcels/month
          </span>
          <span className="text-tac-border">·</span>
          <span>
            <span className="num text-white">
              {fmtAud(report.header.current_monthly_spend, report.header.currency)}
            </span>{" "}
            actual spend
          </span>
        </div>
        <div className="text-xs text-tac-muted mt-3">
          Generated {new Date(generatedAt).toLocaleString("en-AU")} · ID {analysisId.slice(0, 8)}
        </div>
      </div>
      <div className="flex flex-col items-end gap-3">
        <ConfidenceGauge
          score={report.header.confidence_score}
          note={report.header.confidence_note}
        />
        <ShareButton analysisId={analysisId} />
      </div>
    </div>
  );
}

function ShareButton({ analysisId }: { analysisId: string }) {
  const [working, setWorking] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      const res = await fetch("/api/analyzer/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis_id: analysisId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Share failed (${res.status})`);
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const url = `${origin}/share/freight/${body.token}`;
      setShareUrl(url);
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch {
        // Clipboard not available — link is still shown for manual copy.
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Share failed");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="text-right text-xs no-print">
      <button
        type="button"
        onClick={generate}
        disabled={working}
        className="border border-tac-border hover:border-tac-accent text-tac-text px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
      >
        {working ? "Generating…" : shareUrl ? "Generate new link" : "Share read-only link"}
      </button>
      {shareUrl && (
        <div className="mt-2 max-w-[260px] flex flex-col items-end gap-1">
          <input
            readOnly
            value={shareUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full text-[11px] bg-tac-bg-card border border-tac-border rounded px-2 py-1 text-tac-muted"
          />
          <span className="text-tac-muted">
            {copied ? "Copied to clipboard" : "Expires in 30 days"}
          </span>
        </div>
      )}
      {error && <div className="mt-2 text-tac-danger max-w-[260px]">{error}</div>}
    </div>
  );
}

function ConfidenceGauge({ score, note }: { score: number; note: string }) {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const dash = (score / 100) * circumference;
  const colour =
    score >= 75 ? TAC_PALETTE.teal : score >= 50 ? TAC_PALETTE.tangerine : TAC_PALETTE.tiger;
  return (
    <div className="flex items-center gap-4">
      <svg width="100" height="100" viewBox="0 0 100 100" className="shrink-0">
        <circle cx="50" cy="50" r={radius} stroke={CHART_GRID} strokeWidth="8" fill="none" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          stroke={colour}
          strokeWidth="8"
          fill="none"
          strokeDasharray={`${dash} ${circumference}`}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
        />
        <text
          x="50"
          y="54"
          textAnchor="middle"
          fill="white"
          fontSize="20"
          fontWeight={600}
        >
          {score}
        </text>
      </svg>
      <div className="max-w-[260px] text-xs text-tac-muted leading-relaxed">{note}</div>
    </div>
  );
}

function HeadlineCards({ report, fuelMode }: { report: AnalyzerReport; fuelMode: FuelMode }) {
  const view = report.headline_savings.fuel_views.find((v) => v.fuel_mode === fuelMode);
  if (!view) return null;
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <Stat label="Annual savings" value={fmtAud(view.annual_savings_aud)} accent />
      <Stat label="Monthly savings" value={fmtAud(view.monthly_savings_aud)} />
      <Stat label="Savings %" value={`${view.savings_pct.toFixed(1)}%`} />
      <Stat
        label="Projected annual"
        value={fmtAud(view.projected_monthly_spend * 12)}
        sub={`Current ${fmtAud(view.current_monthly_spend * 12)}`}
      />
    </div>
  );
}

function SensitivityStrip({ report }: { report: AnalyzerReport }) {
  const s = report.headline_savings.sensitivity;
  return (
    <div className="mt-4 card flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-sm">
      <div className="text-tac-muted leading-relaxed max-w-xl">
        <span className="text-xs uppercase tracking-wide text-tac-muted/80 mr-2">
          Sensitivity
        </span>
        {s.basis}
      </div>
      <div className="num flex items-center gap-4 text-sm text-tac-muted">
        <span>
          Low <span className="text-tac-muted/90">{fmtAud(s.low_annual_aud)}</span>
        </span>
        <span className="text-tac-border">·</span>
        <span>
          Mid{" "}
          <span className="text-white font-medium">{fmtAud(s.mid_annual_aud)}</span>
        </span>
        <span className="text-tac-border">·</span>
        <span>
          High <span className="text-tac-muted/90">{fmtAud(s.high_annual_aud)}</span>
        </span>
      </div>
    </div>
  );
}

interface SpendGroup {
  key: string;
  carrier: string;
  service_level: string;
  lanes: SpendComparisonRow[];
  total_monthly_shipments: number;
  total_current_monthly: number;
  total_projected_monthly: number;
  total_annual_savings: number;
  worst_status: SpendComparisonRow["status"];
}

function groupSpendRows(rows: SpendComparisonRow[]): SpendGroup[] {
  const buckets = new Map<string, SpendGroup>();
  const statusRank: Record<SpendComparisonRow["status"], number> = {
    matched: 0,
    partial_coverage: 1,
    service_tier_gap: 2,
    no_zone_match: 3,
  };
  for (const row of rows) {
    const key = `${row.carrier}|${row.service_level}`;
    let group = buckets.get(key);
    if (!group) {
      group = {
        key,
        carrier: row.carrier,
        service_level: row.service_level,
        lanes: [],
        total_monthly_shipments: 0,
        total_current_monthly: 0,
        total_projected_monthly: 0,
        total_annual_savings: 0,
        worst_status: row.status,
      };
      buckets.set(key, group);
    }
    group.lanes.push(row);
    group.total_monthly_shipments += row.monthly_shipments;
    group.total_current_monthly += row.current_cpo * row.monthly_shipments;
    group.total_projected_monthly += row.projected_cpo * row.monthly_shipments;
    group.total_annual_savings += row.annual_savings;
    if (statusRank[row.status] > statusRank[group.worst_status]) {
      group.worst_status = row.status;
    }
  }
  buckets.forEach((group) => {
    group.lanes.sort((a, b) => b.annual_savings - a.annual_savings);
  });
  const result: SpendGroup[] = [];
  buckets.forEach((group) => result.push(group));
  return result.sort((a, b) => b.total_annual_savings - a.total_annual_savings);
}

function SpendAccordion({
  rows,
  currency,
}: {
  rows: SpendComparisonRow[];
  currency: string;
}) {
  const groups = useMemo(() => groupSpendRows(rows), [rows]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (groups.length === 0) {
    return <Empty label="No spend comparison rows to show." />;
  }

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(groups.map((g) => g.key)));
  const collapseAll = () => setExpanded(new Set());
  const allOpen = expanded.size === groups.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-tac-muted">
        <span>
          <span className="num text-white">{groups.length}</span> carrier · service group
          {groups.length === 1 ? "" : "s"} ·{" "}
          <span className="num text-white">{rows.length}</span> lane
          {rows.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={allOpen ? collapseAll : expandAll}
          className="text-xs text-tac-accent hover:text-tac-danger transition-colors no-print"
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>

      {groups.map((group) => (
        <SpendGroupRow
          key={group.key}
          group={group}
          currency={currency}
          open={expanded.has(group.key)}
          onToggle={() => toggle(group.key)}
        />
      ))}
    </div>
  );
}

function SpendGroupRow({
  group,
  currency,
  open,
  onToggle,
}: {
  group: SpendGroup;
  currency: string;
  open: boolean;
  onToggle: () => void;
}) {
  const positiveSavings = group.total_annual_savings > 0;
  return (
    <div className="card-interactive p-0 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full text-left px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-2 hover:bg-tac-bg/40 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-[220px] flex-1">
          <span
            className={`inline-block text-tac-muted transition-transform ${
              open ? "rotate-90" : ""
            }`}
            aria-hidden="true"
          >
            ▸
          </span>
          <div>
            <div className="text-white font-medium">{group.carrier}</div>
            <div className="text-xs text-tac-muted">{group.service_level}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs text-tac-muted">
          <div>
            <span className="num text-white">
              {group.lanes.length}
            </span>{" "}
            lane{group.lanes.length === 1 ? "" : "s"}
          </div>
          <div>
            <span className="num text-white">
              {Math.round(group.total_monthly_shipments).toLocaleString()}
            </span>{" "}
            parcels/mo
          </div>
          <div>
            Current{" "}
            <span className="num text-white">
              {fmtAud(group.total_current_monthly, currency)}
            </span>
          </div>
          <div>
            Projected{" "}
            <span className="num text-white">
              {fmtAud(group.total_projected_monthly, currency)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 ml-auto">
          <StatusBadge status={group.worst_status} />
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-tac-muted">
              Annual savings
            </div>
            <div
              className={`num text-lg font-semibold leading-tight ${
                positiveSavings ? "text-tac-success" : "text-tac-muted"
              }`}
            >
              {fmtAud(group.total_annual_savings, currency)}
            </div>
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-tac-border bg-tac-bg/30 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-tac-muted border-b border-tac-border/60">
                <Th>Zone</Th>
                <Th align="right">Volume</Th>
                <Th align="right">Current CPO</Th>
                <Th align="right">Projected CPO</Th>
                <Th align="right">Δ / parcel</Th>
                <Th align="right">Annual savings</Th>
                <Th>Replacement</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {group.lanes.map((row) => (
                <tr key={row.lane_id} className="border-b border-tac-border/30 last:border-0">
                  <Td>{row.zone_label}</Td>
                  <Td align="right">{row.monthly_shipments.toLocaleString()}</Td>
                  <Td align="right">{fmtAud(row.current_cpo, currency)}</Td>
                  <Td align="right">{fmtAud(row.projected_cpo, currency)}</Td>
                  <Td align="right" className={row.cpo_delta_aud > 0 ? "text-tac-success" : ""}>
                    {row.cpo_delta_aud > 0 ? "−" : ""}
                    {fmtAud(Math.abs(row.cpo_delta_aud), currency)}
                  </Td>
                  <Td align="right" className={row.annual_savings > 0 ? "text-tac-success" : ""}>
                    {fmtAud(row.annual_savings, currency)}
                  </Td>
                  <Td>{row.replacement_carrier ?? "—"}</Td>
                  <Td>
                    <StatusBadge status={row.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: SpendComparisonRow["status"] }) {
  const config: Record<SpendComparisonRow["status"], { label: string; cls: string }> = {
    matched: { label: "Matched", cls: "bg-tac-success/20 text-tac-success" },
    service_tier_gap: { label: "Tier gap", cls: "bg-tac-danger/20 text-tac-danger" },
    no_zone_match: { label: "No zone", cls: "bg-tac-danger/20 text-tac-danger" },
    partial_coverage: { label: "Partial", cls: "bg-tac-warning/20 text-tac-warning" },
  };
  const c = config[status];
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs ${c.cls}`}>{c.label}</span>
  );
}

type DrillTab = "state" | "region" | "carrier_zone" | "size";

function DrillDownTabs({ report }: { report: AnalyzerReport }) {
  const [tab, setTab] = useState<DrillTab>("state");
  const tabs: { key: DrillTab; label: string }[] = [
    { key: "state", label: "State" },
    { key: "region", label: "Region" },
    { key: "carrier_zone", label: "Carrier · Zone" },
    { key: "size", label: "Size breaks" },
  ];
  return (
    <div>
      <div className="inline-flex rounded-md overflow-hidden border border-tac-border mb-4">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-xs font-medium ${
              tab === t.key ? "bg-tac-accent text-white" : "text-tac-muted hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "state" && <StateDrill rows={report.drilldown.state_breakdown} />}
      {tab === "region" && <RegionDrill rows={report.drilldown.region_breakdown} />}
      {tab === "carrier_zone" && (
        <CarrierZoneDrill rows={report.drilldown.carrier_zone_breakdown} />
      )}
      {tab === "size" && <SizeDrill rows={report.drilldown.size_breaks} />}
    </div>
  );
}

function StateDrill({ rows }: { rows: StateBreakdownRow[] }) {
  if (rows.length === 0) return <Empty label="No state distribution available" />;
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="card">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={rows} margin={{ top: 16, right: 8, left: 0, bottom: 16 }}>
            <CartesianGrid stroke={CHART_GRID} vertical={false} />
            <XAxis dataKey="state" stroke={CHART_TICK} tick={{ fill: CHART_TICK, fontSize: 12 }} />
            <YAxis stroke={CHART_TICK} tick={{ fill: CHART_TICK, fontSize: 12 }} tickFormatter={(v) => fmtAud(Number(v))} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtAud(Number(v))} />
            <Legend wrapperStyle={{ color: CHART_TICK, fontSize: 12 }} />
            <Bar dataKey="current_monthly_spend" name="Current" fill={TAC_PALETTE.teal} />
            <Bar dataKey="projected_monthly_spend" name="Projected" fill={TAC_PALETTE.tiger} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="card overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-tac-muted border-b border-tac-border">
              <Th>State</Th>
              <Th align="right">Share</Th>
              <Th align="right">Volume</Th>
              <Th align="right">Savings</Th>
              <Th align="right">%</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.state} className="border-b border-tac-border/40">
                <Td>{r.state}</Td>
                <Td align="right">{r.share_pct.toFixed(1)}%</Td>
                <Td align="right">{Math.round(r.monthly_shipments).toLocaleString()}</Td>
                <Td align="right" className={r.savings_aud > 0 ? "text-tac-success" : ""}>
                  {fmtAud(r.savings_aud)}
                </Td>
                <Td align="right">{r.savings_pct.toFixed(1)}%</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RegionDrill({ rows }: { rows: RegionBreakdownRow[] }) {
  if (rows.length === 0) return <Empty label="No region data" />;
  const grouped = new Map<string, RegionBreakdownRow[]>();
  for (const r of rows) {
    const arr = grouped.get(r.state) ?? [];
    arr.push(r);
    grouped.set(r.state, arr);
  }
  return (
    <div className="card overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-tac-muted border-b border-tac-border">
            <Th>State</Th>
            <Th>Region</Th>
            <Th align="right">Volume</Th>
            <Th align="right">Current</Th>
            <Th align="right">Projected</Th>
            <Th align="right">Savings</Th>
          </tr>
        </thead>
        <tbody>
          {Array.from(grouped.entries()).map(([state, regions]) =>
            regions.map((r, idx) => (
              <tr key={`${state}-${r.region}`} className="border-b border-tac-border/40">
                <Td>{idx === 0 ? state : ""}</Td>
                <Td>{r.region}</Td>
                <Td align="right">{Math.round(r.monthly_shipments).toLocaleString()}</Td>
                <Td align="right">{fmtAud(r.current_monthly_spend)}</Td>
                <Td align="right">{fmtAud(r.projected_monthly_spend)}</Td>
                <Td align="right" className={r.savings_aud > 0 ? "text-tac-success" : ""}>
                  {fmtAud(r.savings_aud)}
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function CarrierZoneDrill({
  rows,
}: {
  rows: AnalyzerReport["drilldown"]["carrier_zone_breakdown"];
}) {
  if (rows.length === 0) return <Empty label="No carrier-zone data" />;
  return (
    <div className="card overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-tac-muted border-b border-tac-border">
            <Th>Carrier</Th>
            <Th>Service</Th>
            <Th>Zone</Th>
            <Th align="right">Volume</Th>
            <Th align="right">Current</Th>
            <Th align="right">Projected</Th>
            <Th align="right">Savings</Th>
            <Th align="right">%</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.carrier_code}|${r.service_level}|${r.zone_label}`} className="border-b border-tac-border/40">
              <Td>{r.carrier_code}</Td>
              <Td>{r.service_level}</Td>
              <Td>{r.zone_label}</Td>
              <Td align="right">{r.monthly_shipments.toLocaleString()}</Td>
              <Td align="right">{fmtAud(r.current_monthly_spend)}</Td>
              <Td align="right">{fmtAud(r.projected_monthly_spend)}</Td>
              <Td align="right" className={r.savings_aud > 0 ? "text-tac-success" : ""}>
                {fmtAud(r.savings_aud)}
              </Td>
              <Td align="right">{r.savings_pct.toFixed(1)}%</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SizeDrill({ rows }: { rows: SizeBreakRow[] }) {
  if (rows.length === 0) return <Empty label="No size break data" />;
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="card">
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie data={rows} dataKey="share_pct" nameKey="label" innerRadius={60} outerRadius={100}>
              {rows.map((_, idx) => (
                <Cell key={idx} fill={SIZE_COLORS[idx % SIZE_COLORS.length]} stroke="none" />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${Number(v).toFixed(1)}%`} />
            <Legend wrapperStyle={{ color: CHART_TICK, fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="card overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-tac-muted border-b border-tac-border">
              <Th>Bucket</Th>
              <Th align="right">Share</Th>
              <Th align="right">Volume</Th>
              <Th align="right">Current avg</Th>
              <Th align="right">Projected avg</Th>
              <Th align="right">Annual saving</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.bucket_id} className="border-b border-tac-border/40">
                <Td>{r.label}</Td>
                <Td align="right">{r.share_pct.toFixed(1)}%</Td>
                <Td align="right">{Math.round(r.monthly_shipments).toLocaleString()}</Td>
                <Td align="right">{fmtAud(r.current_avg_cpo)}</Td>
                <Td align="right">{fmtAud(r.projected_avg_cpo)}</Td>
                <Td align="right" className={r.annual_savings > 0 ? "text-tac-success" : ""}>
                  {fmtAud(r.annual_savings)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const SIZE_COLORS = [
  TAC_PALETTE.tiger,
  TAC_PALETTE.teal,
  TAC_PALETTE.tangerine,
  TAC_PALETTE.blue,
  "#A6BFC6",
];

function OpportunityCards({ opportunities }: { opportunities: TopOpportunity[] }) {
  if (opportunities.length === 0) {
    return <Empty label="No opportunities surfaced — all lanes already optimised or blocked." />;
  }
  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
      {opportunities.map((opp) => (
        <div key={opp.lane_id} className="card">
          <div className="text-xs uppercase text-tac-muted">Rank #{opp.rank}</div>
          <div className="text-white font-medium mt-1">{opp.lane}</div>
          <div className="text-2xl text-tac-success font-semibold mt-2">
            {fmtAud(opp.annual_savings_aud)}
          </div>
          <div className="text-xs text-tac-muted">
            {opp.monthly_volume.toLocaleString()} parcels/mo · Δ {fmtAud(opp.per_parcel_delta_aud)}/parcel
          </div>
          <p className="text-sm text-tac-muted mt-3 leading-relaxed">{opp.consultant_note}</p>
        </div>
      ))}
    </div>
  );
}

function ServiceTierTable({ pairs }: { pairs: ServiceTierPair[] }) {
  if (pairs.length === 0) return <Empty label="No service-tier pairs to evaluate." />;
  return (
    <div className="card overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-tac-muted border-b border-tac-border">
            <Th>Carrier</Th>
            <Th>Service tier</Th>
            <Th align="right">Volume</Th>
            <Th align="right">Spend</Th>
            <Th>Eligible replacements</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {pairs.map((p) => (
            <tr
              key={`${p.current_carrier_code}|${p.service_level}`}
              className="border-b border-tac-border/40"
            >
              <Td>{p.current_carrier_name}</Td>
              <Td>{p.service_level}</Td>
              <Td align="right">{p.monthly_shipments.toLocaleString()}</Td>
              <Td align="right">{fmtAud(p.monthly_spend_aud)}</Td>
              <Td>
                {p.replacements.length === 0
                  ? "—"
                  : p.replacements.map((r) => r.carrier_name).join(", ")}
              </Td>
              <Td>
                <span
                  className={`inline-block px-2 py-0.5 rounded text-xs ${
                    p.status === "matched"
                      ? "bg-tac-success/20 text-tac-success"
                      : "bg-tac-danger/20 text-tac-danger"
                  }`}
                >
                  {p.status === "matched" ? "Matched" : "No equivalent"}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CoverageTable({ gaps }: { gaps: CoverageGap[] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-tac-muted border-b border-tac-border">
            <Th>Carrier</Th>
            <Th>Service</Th>
            <Th align="right">Postcodes outside footprint</Th>
            <Th>States not fully covered</Th>
            <Th align="right">Volume value outside footprint / month</Th>
          </tr>
        </thead>
        <tbody>
          {gaps.map((g, idx) => (
            <tr key={idx} className="border-b border-tac-border/40">
              <Td>{g.carrier_code}</Td>
              <Td>{g.service_level}</Td>
              <Td align="right">{g.uncovered_postcode_count.toLocaleString()}</Td>
              <Td>
                {g.uncovered_state_share.length === 0
                  ? "—"
                  : g.uncovered_state_share
                      .map((s) => `${s.state} (${s.share_pct.toFixed(1)}%)`)
                      .join(", ")}
              </Td>
              <Td align="right">{fmtAud(g.exposure_aud_per_month)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecommendationList({ recs }: { recs: Recommendation[] }) {
  if (recs.length === 0) return <Empty label="No recommendations." />;
  return (
    <ul className="space-y-3">
      {recs.map((r, idx) => (
        <li key={idx} className="card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-white font-medium">{r.title}</div>
              <p className="text-sm text-tac-muted mt-1 leading-relaxed">{r.rationale}</p>
            </div>
            {r.estimated_impact_aud_per_year != null && (
              <div className="text-tac-success text-sm whitespace-nowrap">
                {fmtAud(r.estimated_impact_aud_per_year)}/yr
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

const CATEGORY_LABELS: Record<ReviewCategory, string> = {
  math: "Math reconciliation",
  table_analysis: "Spend comparison table",
  methodology: "Methodology fit",
  recommendations: "Recommendations vs data",
  narrative: "Narrative consistency",
  context: "Context completeness",
  customer_facing: "Customer-facing readiness",
  general: "General",
};

const CATEGORY_ORDER: ReviewCategory[] = [
  "customer_facing",
  "math",
  "table_analysis",
  "methodology",
  "recommendations",
  "context",
  "narrative",
  "general",
];

const SEVERITY_RANK: Record<"info" | "warn" | "block", number> = {
  block: 0,
  warn: 1,
  info: 2,
};

function ReadinessBanner({ review }: { review: ReviewResult }) {
  if (review.customer_facing_ready === undefined) return null;
  const ready = review.customer_facing_ready;
  const blockers = review.readiness_blockers ?? [];
  const summary = review.readiness_summary?.trim();
  const accent = ready ? TAC_PALETTE.teal : TAC_PALETTE.tangerine;
  const label = ready ? "Customer-facing ready" : "Not customer-facing ready";

  return (
    <div className="card-elevated border-l-4" style={{ borderLeftColor: accent }}>
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="flex-1 min-w-[240px]">
          <div
            className="text-[11px] uppercase tracking-[0.1em] font-medium"
            style={{ color: accent }}
          >
            Critic verdict · {review.verdict.replace("_", " ")}
          </div>
          <div className="font-poppins text-xl font-semibold tracking-tight text-white mt-1">
            {label}
          </div>
          {summary && (
            <p className="text-sm text-tac-muted mt-2 leading-relaxed max-w-3xl">{summary}</p>
          )}
        </div>
        {!ready && blockers.length > 0 && (
          <div className="text-sm min-w-[220px]">
            <div className="text-xs uppercase tracking-wide text-tac-muted mb-1.5">
              Blockers
            </div>
            <ul className="space-y-1 text-tac-warning list-disc pl-4">
              {blockers.slice(0, 5).map((b, idx) => (
                <li key={idx}>{b}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewPanel({ review }: { review: ReviewResult }) {
  const findings = [...review.findings].sort((a, b) => {
    const sevDelta = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sevDelta !== 0) return sevDelta;
    const aCat = a.category ?? "general";
    const bCat = b.category ?? "general";
    return CATEGORY_ORDER.indexOf(aCat) - CATEGORY_ORDER.indexOf(bCat);
  });

  const grouped = new Map<ReviewCategory, ReviewFinding[]>();
  for (const f of findings) {
    const cat = f.category ?? "general";
    const arr = grouped.get(cat) ?? [];
    arr.push(f);
    grouped.set(cat, arr);
  }

  const counts = {
    block: findings.filter((f) => f.severity === "block").length,
    warn: findings.filter((f) => f.severity === "warn").length,
    info: findings.filter((f) => f.severity === "info").length,
  };

  const strengths = review.strengths ?? [];

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="text-xs uppercase tracking-wide text-tac-muted">Summary</span>
        <span>
          <span className="num text-white">{findings.length}</span> finding
          {findings.length === 1 ? "" : "s"} ·{" "}
          <span className="num text-tac-danger">{counts.block}</span> block ·{" "}
          <span className="num text-tac-warning">{counts.warn}</span> warn ·{" "}
          <span className="num text-tac-success">{counts.info}</span> info
        </span>
        <span className="text-tac-border hidden md:inline">·</span>
        <span className="text-tac-muted">
          {review.revision_count} narrative revision{review.revision_count === 1 ? "" : "s"}
        </span>
      </div>

      {strengths.length > 0 && (
        <div className="card border-l-4" style={{ borderLeftColor: TAC_PALETTE.teal }}>
          <div className="text-xs uppercase tracking-wide text-tac-muted mb-2">
            Strengths the consultant can lean on
          </div>
          <ul className="text-sm text-white space-y-1 list-disc pl-5">
            {strengths.map((s, idx) => (
              <li key={idx}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {findings.length === 0 ? (
        <div className="card text-sm text-tac-muted">
          Critic returned no findings — report passed unchallenged. Sense-check that
          nothing material was missed before sharing.
        </div>
      ) : (
        CATEGORY_ORDER.filter((c) => grouped.has(c)).map((cat) => (
          <FindingGroup key={cat} category={cat} findings={grouped.get(cat) ?? []} />
        ))
      )}
    </div>
  );
}

function FindingGroup({
  category,
  findings,
}: {
  category: ReviewCategory;
  findings: ReviewFinding[];
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.08em] text-tac-muted font-medium mb-2">
        {CATEGORY_LABELS[category]} ·{" "}
        <span className="num text-white">{findings.length}</span>
      </div>
      <ul className="space-y-2">
        {findings.map((f, idx) => (
          <li
            key={idx}
            className="card border-l-4"
            style={{ borderLeftColor: severityColour(f.severity) }}
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span
                className="text-[10px] uppercase tracking-wide font-medium"
                style={{ color: severityColour(f.severity) }}
              >
                {f.severity}
              </span>
              {f.linked_section && (
                <span className="num text-xs text-tac-muted">{f.linked_section}</span>
              )}
            </div>
            <div className="text-white text-sm mt-1.5">{f.claim}</div>
            <p className="text-sm text-tac-muted mt-1 leading-relaxed">{f.issue}</p>
            {f.evidence && (
              <pre className="num text-xs text-tac-muted mt-2 whitespace-pre-wrap">
                {f.evidence}
              </pre>
            )}
            {f.fix && <div className="text-xs text-tac-success mt-2">Fix: {f.fix}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function WarningsList({ warnings }: { warnings: Warning[] }) {
  return (
    <ul className="space-y-2">
      {warnings.map((w, idx) => (
        <li key={idx} className="card border-l-4" style={{ borderLeftColor: severityColour(w.severity) }}>
          <div className="text-xs uppercase tracking-wide text-tac-muted">
            {w.severity} {w.linked_section ? `· ${w.linked_section}` : ""}
          </div>
          <div className="text-white text-sm mt-1">{w.title}</div>
          <p className="text-sm text-tac-muted mt-1 leading-relaxed">{w.body}</p>
        </li>
      ))}
    </ul>
  );
}

function ContextBlock({
  context,
  analystSummary,
}: {
  context: ContextConfirmation;
  analystSummary: string | undefined;
}) {
  const fuelLabel: Record<ContextConfirmation["assumptions"]["default_fuel_mode"], string> = {
    base: "Base only",
    with_fuel: "Base + fuel",
    with_all_surcharges: "All surcharges",
  };
  const summary = (analystSummary ?? "").trim();
  const showSummary = summary && summary !== "(narrative pass fills this in)";

  return (
    <div className="space-y-4">
      {showSummary && (
        <div className="card border-l-4" style={{ borderLeftColor: TAC_PALETTE.teal }}>
          <div className="text-xs uppercase tracking-wide text-tac-muted">
            Analyst summary
          </div>
          <p className="text-sm text-white mt-2 leading-relaxed whitespace-pre-line">
            {summary}
          </p>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <ContextCard title="Tenant & period">
          <ContextRow label="Tenant" value={`${context.tenant.name} (${context.tenant.kind})`} />
          <ContextRow label="Period" value={context.period.label} />
          <ContextRow label="Currency" value={context.tenant.currency} />
        </ContextCard>

        <ContextCard title="Scope">
          <ContextRow
            label="Total monthly shipments"
            value={Math.round(context.scope.total_monthly_shipments).toLocaleString()}
          />
          <ContextRow label="Lanes analysed" value={context.scope.lane_count.toLocaleString()} />
          <ContextRow
            label="States covered"
            value={context.scope.state_coverage_count.toLocaleString()}
          />
          <ContextRow
            label="Unmapped postcode share"
            value={`${context.scope.unmapped_state_pct.toFixed(1)}%`}
          />
        </ContextCard>

        <ContextCard title="Current carriers compared">
          {context.current_carriers.length === 0 ? (
            <div className="text-sm text-tac-muted">No current carrier data.</div>
          ) : (
            <ul className="space-y-2">
              {context.current_carriers.map((c) => (
                <li key={c.carrier_code} className="text-sm">
                  <div className="text-white">
                    {c.carrier_name}{" "}
                    <span className="text-tac-muted text-xs">({c.carrier_code || "—"})</span>
                  </div>
                  <div className="text-xs text-tac-muted">
                    {c.service_levels.join(", ") || "—"} ·{" "}
                    {Math.round(c.monthly_shipments).toLocaleString()} parcels/mo ·{" "}
                    {fmtAud(c.monthly_spend_aud)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ContextCard>

        <ContextCard title="Replacement carriers compared">
          {context.replacement_carriers.length === 0 ? (
            <div className="text-sm text-tac-muted">No replacement rate cards loaded.</div>
          ) : (
            <ul className="space-y-2">
              {context.replacement_carriers.map((c) => (
                <li key={c.carrier_code} className="text-sm">
                  <div className="text-white">
                    {c.carrier_name}{" "}
                    <span className="text-tac-muted text-xs">({c.carrier_code || "—"})</span>
                  </div>
                  <div className="text-xs text-tac-muted">
                    {c.service_levels.join(", ") || "—"} · {c.rate_card_count} rate card
                    {c.rate_card_count === 1 ? "" : "s"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ContextCard>

        <ContextCard title="Assumptions">
          <ContextRow
            label="Density"
            value={`${context.assumptions.density_kg_per_m3} kg/m³`}
          />
          <ContextRow
            label="Residential mix"
            value={`${context.assumptions.residential_mix_pct.toFixed(0)}%`}
          />
          <ContextRow
            label="Default fuel view"
            value={fuelLabel[context.assumptions.default_fuel_mode]}
          />
          <ContextRow
            label="Per-carrier fuel overrides"
            value={
              context.assumptions.per_carrier_fuel_overrides.length === 0
                ? "None"
                : context.assumptions.per_carrier_fuel_overrides
                    .map((o) => `${o.carrier_code} @ ${o.fuel_pct}%`)
                    .join(", ")
            }
          />
          <ContextRow
            label="Service-tier pair overrides"
            value={
              context.assumptions.service_tier_pair_override_count === 0
                ? "None"
                : `${context.assumptions.service_tier_pair_override_count} applied`
            }
          />
        </ContextCard>

        <ContextCard title="Exclusions">
          <ContextRow
            label="Unmatched lanes"
            value={context.exclusions.unmatched_lane_count.toLocaleString()}
            tone={context.exclusions.unmatched_lane_count > 0 ? "warn" : "neutral"}
          />
          <ContextRow
            label="Held at current cost"
            value={`${Math.round(context.exclusions.unmatched_monthly_shipments).toLocaleString()} parcels/mo`}
          />
          <ContextRow
            label="Replacement carriers with partial footprint"
            value={context.exclusions.coverage_gap_count.toLocaleString()}
            tone="neutral"
          />
        </ContextCard>
      </div>
    </div>
  );
}

function ContextCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-tac-muted mb-3">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ContextRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warn";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-tac-muted text-xs uppercase tracking-wide">{label}</span>
      <span
        className={`num text-right text-sm ${
          tone === "warn" ? "text-tac-warning" : "text-white"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function MethodologyBlock({ report }: { report: AnalyzerReport }) {
  const m = report.methodology;
  const items: { label: string; value: string }[] = [
    { label: "Default fuel mode", value: m.default_fuel_mode },
    { label: "Density assumption", value: `${m.density_assumption_kg_per_m3} kg/m³` },
    { label: "Weight distribution", value: m.weight_distribution_basis },
    { label: "Postcode distribution", value: m.postcode_distribution_basis },
    { label: "Surcharge treatment", value: m.surcharge_treatment },
    { label: "Unmatched lanes", value: m.unmatched_treatment },
    { label: "Confidence formula", value: m.confidence_formula_plain_english },
  ];
  return (
    <dl className="card grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
      {items.map((i) => (
        <div key={i.label}>
          <dt className="text-xs uppercase text-tac-muted tracking-wide">{i.label}</dt>
          <dd className="text-tac-muted mt-1">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DraftBanner({ blockers, warns }: { blockers: Warning[]; warns: Warning[] }) {
  return (
    <div className="card border-l-4 border-tac-warning">
      <div className="text-tac-warning text-sm font-medium">Draft — review before sharing</div>
      <ul className="text-sm text-tac-muted mt-1 list-disc pl-5 space-y-1">
        {blockers.map((w) => (
          <li key={w.code}>{w.title}</li>
        ))}
        {warns.slice(0, 3).map((w) => (
          <li key={w.code}>{w.title}</li>
        ))}
      </ul>
    </div>
  );
}

function BlockedBanner({ blockers }: { blockers: Warning[] }) {
  return (
    <div className="card border-l-4 border-tac-danger">
      <div className="text-tac-danger text-sm font-medium">Blocked — cannot publish as-is</div>
      <ul className="text-sm text-tac-muted mt-1 list-disc pl-5 space-y-1">
        {blockers.map((w) => (
          <li key={w.code}>{w.title}</li>
        ))}
      </ul>
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
    <section>
      <div className="mb-5">
        <div className="section-rule" />
        <h2 className="font-poppins text-xl font-semibold tracking-tight text-white">
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm text-tac-muted mt-1.5 max-w-3xl leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="card-elevated">
      <div className="text-[11px] uppercase tracking-[0.08em] text-tac-muted font-medium">
        {label}
      </div>
      <div
        className={`num mt-2 text-3xl font-semibold tracking-tight leading-none ${
          accent ? "text-tac-success" : "text-white"
        }`}
      >
        {value}
      </div>
      {sub && <div className="num text-xs text-tac-muted mt-2">{sub}</div>}
    </div>
  );
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "right" | "left";
}) {
  return (
    <th
      className={`px-3 py-2 text-xs font-medium uppercase tracking-wide ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  className,
}: {
  children: React.ReactNode;
  align?: "right" | "left";
  className?: string;
}) {
  return (
    <td
      className={`px-3 py-2.5 text-sm ${align === "right" ? "text-right num" : ""} ${className ?? ""}`}
    >
      {children}
    </td>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="card text-sm text-tac-muted text-center py-6 border border-dashed">
      {label}
    </div>
  );
}

function severityColour(severity: "info" | "warn" | "block"): string {
  if (severity === "block") return TAC_PALETTE.tiger;
  if (severity === "warn") return TAC_PALETTE.tangerine;
  return TAC_PALETTE.teal;
}

const tooltipStyle: React.CSSProperties = {
  background: "#1F3040",
  border: "1px solid #2D4050",
  borderRadius: 6,
  fontSize: 12,
  color: "#FFFFFF",
};

function fmtAud(value: number, currency = "AUD"): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}
