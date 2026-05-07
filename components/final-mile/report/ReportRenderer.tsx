import type {
  AnalyzerReport,
  Recommendation,
  TopOpportunity,
  Warning,
} from "@/lib/analyzer/report-types";
import { RegionBars, SharePie, SpendBars } from "./charts";

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
  const isDraft = report.report_state === "draft_only";
  const blockingWarnings = report.warnings.filter((w) => w.severity === "block");

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 space-y-12">
      {isDraft && <DraftBanner blockers={blockingWarnings} />}

      <Header report={report} generatedAt={generatedAt} analysisId={analysisId} />

      <Section title="Headline savings" subtitle={report.headline_savings.framing}>
        <HeadlineCards report={report} />
      </Section>

      <Section
        title="Spend comparison"
        subtitle="Current vs projected spend by carrier × service. Negative deltas mean savings."
      >
        <div className="card mb-6">
          <SpendBars data={report.spend_comparison.chart_data} />
        </div>
        <SpendTable rows={report.spend_comparison.table} currency={report.header.currency} />
      </Section>

      <Section
        title="State / region breakdown"
        subtitle={`Where the spend lives. Unmapped: ${report.region_breakdown.unmapped_pct.toFixed(1)}% of shipments couldn't be classified.`}
      >
        <div className="grid md:grid-cols-3 gap-6 mb-6">
          <div className="card md:col-span-2">
            <RegionBars data={report.region_breakdown.chart_data} />
          </div>
          <div className="card">
            <SharePie
              data={report.region_breakdown.table.map((r) => ({
                region: r.region,
                share_pct: r.share_pct,
              }))}
            />
          </div>
        </div>
        <RegionTable rows={report.region_breakdown.table} currency={report.header.currency} />
      </Section>

      <Section
        title="Cube analysis"
        subtitle={report.cube_analysis.estimation_note}
      >
        <CubeCards report={report} />
        {report.cube_analysis.dim_risk_lanes.length > 0 && (
          <div className="card mt-6">
            <h3 className="text-sm font-semibold text-tac-text mb-3">DIM-billed risk lanes</h3>
            <ul className="space-y-2 text-sm">
              {report.cube_analysis.dim_risk_lanes.map((lane, idx) => (
                <li
                  key={idx}
                  className="flex items-start justify-between gap-4 border-b border-tac-border last:border-0 pb-2 last:pb-0"
                >
                  <div>
                    <div className="font-medium text-tac-text">{lane.lane}</div>
                    <div className="text-tac-muted text-xs mt-0.5">{lane.note}</div>
                  </div>
                  <div className="text-right text-xs text-tac-muted whitespace-nowrap">
                    avg {lane.avg_weight_kg.toFixed(2)} kg →{" "}
                    <span className="text-tac-warning">
                      DIM {lane.estimated_dim_weight_kg.toFixed(2)} kg
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Top opportunities" subtitle="Where the biggest dollar wins live.">
        <TopOpportunities items={report.top_opportunities} />
      </Section>

      <Section title="Recommendations" subtitle="What to do next.">
        <Recommendations items={report.recommendations} />
      </Section>

      {report.warnings.length > 0 && (
        <Section title="Warnings & gaps" subtitle="What this report could not see.">
          <Warnings items={report.warnings} />
        </Section>
      )}

      <Section title="Methodology" subtitle="How the numbers were derived.">
        <Methodology report={report} />
      </Section>
    </div>
  );
}

function DraftBanner({ blockers }: { blockers: Warning[] }) {
  return (
    <div className="rounded border-2 border-tac-warning/60 bg-tac-warning/10 p-4">
      <div className="font-semibold text-tac-warning mb-1">DRAFT — do not send to client</div>
      <p className="text-sm text-tac-text">
        The analyzer flagged blocking warnings. Resolve these before exporting:
      </p>
      <ul className="mt-2 list-disc list-inside text-sm text-tac-text space-y-0.5">
        {blockers.map((w, idx) => (
          <li key={idx}>
            <span className="font-medium">{w.title}</span> — {w.body}
          </li>
        ))}
      </ul>
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
    <div className="border-b border-tac-border pb-8">
      <div className="flex flex-wrap items-baseline justify-between gap-4 mb-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-tac-muted mb-1">
            {report.header.tenant_kind === "client" ? "Client report" : "Prospect report"}
          </div>
          <h1 className="text-4xl font-bold">{report.header.tenant_name}</h1>
          <p className="text-tac-muted mt-2">
            Final mile analysis — {report.header.period_label}
          </p>
        </div>
        <ConfidenceBadge
          score={report.header.confidence_score}
          note={report.header.confidence_note}
        />
      </div>
      <div className="grid sm:grid-cols-3 gap-4 mt-6">
        <Stat
          label="Monthly shipments"
          value={formatNumber(report.header.total_monthly_shipments)}
        />
        <Stat
          label="Current monthly spend"
          value={formatMoney(report.header.current_monthly_spend, report.header.currency)}
        />
        <Stat label="Currency" value={report.header.currency} />
      </div>
      <p className="text-xs text-tac-muted mt-6">
        Generated {new Date(generatedAt).toLocaleString("en-AU")} · Analysis ID{" "}
        <span className="font-mono">{analysisId.slice(0, 8)}</span>
      </p>
    </div>
  );
}

function ConfidenceBadge({ score, note }: { score: number; note: string }) {
  const tone =
    score >= 80
      ? "border-tac-success/40 bg-tac-success/10 text-tac-success"
      : score >= 50
      ? "border-tac-warning/40 bg-tac-warning/10 text-tac-warning"
      : "border-tac-danger/40 bg-tac-danger/10 text-tac-danger";
  return (
    <div className={`rounded border px-4 py-3 max-w-xs ${tone}`}>
      <div className="text-xs uppercase tracking-wide opacity-80 mb-1">Confidence</div>
      <div className="text-2xl font-bold">{score}/100</div>
      <div className="text-xs mt-1 leading-relaxed">{note}</div>
    </div>
  );
}

function HeadlineCards({ report }: { report: AnalyzerReport }) {
  const { headline_savings, header } = report;
  return (
    <div className="grid md:grid-cols-3 gap-4">
      <BigCard
        label="Annual savings"
        value={formatMoney(headline_savings.annual_savings_aud, header.currency)}
        sub={`${headline_savings.savings_pct.toFixed(1)}% of current spend`}
        accent
      />
      <BigCard
        label="Monthly savings"
        value={formatMoney(headline_savings.monthly_savings_aud, header.currency)}
        sub="Run-rate at current volume"
      />
      <BigCard
        label="Current → projected (annual)"
        value={`${formatMoney(headline_savings.current_annual_spend, header.currency)} → ${formatMoney(
          headline_savings.projected_annual_spend,
          header.currency
        )}`}
        sub="Full-year view"
      />
    </div>
  );
}

function CubeCards({ report }: { report: AnalyzerReport }) {
  const { cube_analysis, header } = report;
  return (
    <div className="grid md:grid-cols-4 gap-4">
      <Stat
        label="Monthly cube"
        value={`${formatNumber(cube_analysis.total_monthly_cube_m3)} m³`}
      />
      <Stat
        label="Annual cube"
        value={`${formatNumber(cube_analysis.total_annual_cube_m3)} m³`}
      />
      <Stat
        label="$/m³ current"
        value={formatMoney(cube_analysis.cost_per_m3_current, header.currency)}
      />
      <Stat
        label="$/m³ projected"
        value={formatMoney(cube_analysis.cost_per_m3_projected, header.currency)}
      />
    </div>
  );
}

function SpendTable({
  rows,
  currency,
}: {
  rows: AnalyzerReport["spend_comparison"]["table"];
  currency: string;
}) {
  if (rows.length === 0) {
    return <Empty label="No carrier rows to compare." />;
  }
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-tac-muted border-b border-tac-border">
            <Th>Carrier</Th>
            <Th>Service</Th>
            <Th right>Volume</Th>
            <Th right>Current CPO</Th>
            <Th right>Projected CPO</Th>
            <Th right>Δ CPO</Th>
            <Th right>Monthly save</Th>
            <Th right>Annual save</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr
              key={idx}
              className="border-b border-tac-border/60 last:border-0 hover:bg-tac-bg-light/40"
            >
              <Td>{r.carrier}</Td>
              <Td>{r.service_level}</Td>
              <Td right>{formatNumber(r.monthly_shipments)}</Td>
              <Td right>{formatMoney(r.current_cpo, currency)}</Td>
              <Td right>{formatMoney(r.projected_cpo, currency)}</Td>
              <Td right>
                <DeltaCell
                  delta={r.cpo_delta_aud}
                  pct={r.cpo_delta_pct}
                  currency={currency}
                />
              </Td>
              <Td right>{formatMoney(r.monthly_savings, currency)}</Td>
              <Td right strong>{formatMoney(r.annual_savings, currency)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RegionTable({
  rows,
  currency,
}: {
  rows: AnalyzerReport["region_breakdown"]["table"];
  currency: string;
}) {
  if (rows.length === 0) {
    return <Empty label="No regional data to display." />;
  }
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-tac-muted border-b border-tac-border">
            <Th>Region</Th>
            <Th right>Share</Th>
            <Th right>Volume</Th>
            <Th right>Current spend</Th>
            <Th right>Projected spend</Th>
            <Th right>Savings</Th>
            <Th right>Savings %</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr
              key={idx}
              className="border-b border-tac-border/60 last:border-0 hover:bg-tac-bg-light/40"
            >
              <Td>{r.region}</Td>
              <Td right>{r.share_pct.toFixed(1)}%</Td>
              <Td right>{formatNumber(r.monthly_shipments)}</Td>
              <Td right>{formatMoney(r.current_monthly_spend, currency)}</Td>
              <Td right>{formatMoney(r.projected_monthly_spend, currency)}</Td>
              <Td right strong>{formatMoney(r.savings_aud, currency)}</Td>
              <Td right>{r.savings_pct.toFixed(1)}%</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TopOpportunities({ items }: { items: TopOpportunity[] }) {
  if (items.length === 0) {
    return <Empty label="No standout opportunities surfaced." />;
  }
  return (
    <div className="space-y-3">
      {items.map((op) => (
        <div key={op.rank} className="card flex items-start gap-4">
          <div className="text-3xl font-bold text-tac-accent w-10 flex-shrink-0">{op.rank}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-4 flex-wrap">
              <div className="font-semibold text-tac-text">{op.lane}</div>
              <div className="text-tac-success font-bold">
                {formatMoney(op.annual_savings_aud, "AUD")} / year
              </div>
            </div>
            <p className="text-sm text-tac-muted mt-1.5">{op.consultant_note}</p>
            <div className="flex gap-4 text-xs text-tac-muted mt-2">
              <span>
                <span className="text-tac-text">{formatNumber(op.monthly_volume)}</span> shipments/mo
              </span>
              <span>
                <span className="text-tac-text">
                  {formatMoney(op.per_parcel_delta_aud, "AUD")}
                </span>{" "}
                / parcel saved
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Recommendations({ items }: { items: Recommendation[] }) {
  if (items.length === 0) {
    return <Empty label="No recommendations from this run." />;
  }
  return (
    <div className="space-y-3">
      {items.map((rec, idx) => (
        <div key={idx} className="card">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <h3 className="font-semibold text-tac-text">{rec.title}</h3>
            {rec.estimated_impact_aud_per_year !== null && (
              <span className="text-tac-success text-sm font-medium">
                ~{formatMoney(rec.estimated_impact_aud_per_year, "AUD")}/yr
              </span>
            )}
          </div>
          <p className="text-sm text-tac-muted mt-2 leading-relaxed">{rec.rationale}</p>
        </div>
      ))}
    </div>
  );
}

function Warnings({ items }: { items: Warning[] }) {
  return (
    <div className="space-y-2">
      {items.map((w, idx) => (
        <div
          key={idx}
          className={`rounded border px-4 py-3 text-sm ${severityClass(w.severity)}`}
        >
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <span className="font-semibold">{w.title}</span>
            <span className="text-xs uppercase tracking-wide opacity-70">
              {w.severity} · {w.code}
            </span>
          </div>
          <p className="opacity-90 leading-relaxed">{w.body}</p>
        </div>
      ))}
    </div>
  );
}

function Methodology({ report }: { report: AnalyzerReport }) {
  const { methodology } = report;
  return (
    <div className="card text-sm space-y-3">
      <Detail label="Density assumption">
        {methodology.density_assumption_kg_per_m3} kg/m³
      </Detail>
      <Detail label="Surcharge treatment">{methodology.surcharge_treatment}</Detail>
      <Detail label="Unmatched lanes">{methodology.unmatched_treatment}</Detail>
      <Detail label="Confidence formula">
        {methodology.confidence_formula_plain_english}
      </Detail>
    </div>
  );
}

// --- Small reusable bits ---

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
      <div className="mb-4">
        <h2 className="text-2xl font-bold">{title}</h2>
        {subtitle && <p className="text-sm text-tac-muted mt-1">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-tac-muted">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

function BigCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`card ${
        accent ? "border-tac-accent/60 bg-tac-accent/5" : ""
      }`}
    >
      <div className="text-xs uppercase tracking-wide text-tac-muted">{label}</div>
      <div className={`text-3xl font-bold mt-1 ${accent ? "text-tac-accent" : ""}`}>
        {value}
      </div>
      <div className="text-xs text-tac-muted mt-2">{sub}</div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-3 py-2 text-xs uppercase tracking-wide font-medium ${right ? "text-right" : ""}`}>
      {children}
    </th>
  );
}

function Td({
  children,
  right,
  strong,
}: {
  children: React.ReactNode;
  right?: boolean;
  strong?: boolean;
}) {
  return (
    <td
      className={`px-3 py-2 ${right ? "text-right" : ""} ${
        strong ? "font-semibold text-tac-text" : "text-tac-text"
      }`}
    >
      {children}
    </td>
  );
}

function DeltaCell({
  delta,
  pct,
  currency,
}: {
  delta: number;
  pct: number;
  currency: string;
}) {
  const tone =
    delta < 0 ? "text-tac-success" : delta > 0 ? "text-tac-danger" : "text-tac-muted";
  const sign = delta > 0 ? "+" : "";
  return (
    <span className={tone}>
      {sign}
      {formatMoney(delta, currency)} ({sign}
      {pct.toFixed(1)}%)
    </span>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-4 items-baseline">
      <div className="text-xs uppercase tracking-wide text-tac-muted">{label}</div>
      <div className="text-tac-text">{children}</div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="card text-sm text-tac-muted italic">{label}</div>
  );
}

function severityClass(sev: Warning["severity"]): string {
  if (sev === "block") return "border-tac-danger/50 bg-tac-danger/10 text-tac-text";
  if (sev === "warn") return "border-tac-warning/50 bg-tac-warning/10 text-tac-text";
  return "border-tac-border bg-tac-bg-card text-tac-text";
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("en-AU")}`;
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 }).format(value);
}
