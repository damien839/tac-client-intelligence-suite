"use client";

import InputField from "@/components/shared/InputField";
import {
  RecommendationId,
  RecommendedScheme,
  Scheme,
  SchemeEvaluation,
  TierConfig,
} from "@/lib/shipping-sim/types";
import { formatCurrency, formatPercent } from "@/lib/calculations";

export type OptionKey = RecommendationId | "custom";

/** Metric subset shared by RecommendedScheme and SchemeEvaluation. */
interface OptionMetrics {
  contributionDelta: number;
  netShippingProfitDelta: number;
  upliftMarginGain: number;
  abandonMarginLoss: number;
  expectedOrdersLost: number;
  freeOrderShare: number;
  recoveryRate: number;
}

interface OptionColumn {
  key: OptionKey | "current";
  label: string;
  schemeSummary: string;
  metrics: OptionMetrics | null;
  isBaseline?: boolean;
  unconstrained?: boolean;
}

interface OptionsComparisonProps {
  recs: RecommendedScheme[] | null; // null = COGS unset
  customEval: SchemeEvaluation | null;
  currentFacts: SchemeEvaluation | null; // current scheme vs itself, behaviour zeroed
  currentScheme: Scheme;
  customScheme: Scheme;
  cogsPercent: number | undefined;
  monthlyOrders: number | undefined;
  upliftRate: number;
  upliftWindow: number;
  abandonRate: number;
  onCogsChange: (value: number | undefined) => void;
  onUpliftRateChange: (value: number) => void;
  onUpliftWindowChange: (value: number) => void;
  onAbandonRateChange: (value: number) => void;
  selected: OptionKey;
  onSelect: (key: OptionKey) => void;
}

function signedCurrency(value: number): string {
  const normalized = value === 0 ? 0 : value; // avoid "+-$0.00" from negative zero
  return `${normalized >= 0 ? "+" : ""}${formatCurrency(normalized)}`;
}

/** Fraction -> percent for display, rounded to 0.1 to hide float artifacts (0.55 -> 55, not 55.00000000000001). */
function toPercent(fraction: number): number {
  return Math.round(fraction * 1000) / 10;
}

function describeStandard(config: TierConfig | undefined): string {
  if (!config) return "—";
  return config.freeThreshold === null
    ? `${formatCurrency(config.fee)} flat`
    : `${formatCurrency(config.fee)}, free over $${config.freeThreshold}`;
}

export default function OptionsComparison({
  recs,
  customEval,
  currentFacts,
  currentScheme,
  customScheme,
  cogsPercent,
  monthlyOrders,
  upliftRate,
  upliftWindow,
  abandonRate,
  onCogsChange,
  onUpliftRateChange,
  onUpliftWindowChange,
  onAbandonRateChange,
  selected,
  onSelect,
}: OptionsComparisonProps) {
  const columns: OptionColumn[] = [
    {
      key: "current",
      label: "Current",
      schemeSummary: describeStandard(currentScheme.standard),
      metrics: currentFacts,
      isBaseline: true,
    },
    ...(recs ?? []).map((rec) => ({
      key: rec.id as OptionKey,
      label: rec.label,
      schemeSummary:
        rec.threshold === null
          ? `${formatCurrency(rec.fee)} flat`
          : `${formatCurrency(rec.fee)}, free over $${rec.threshold}`,
      metrics: rec as OptionMetrics,
      unconstrained: rec.unconstrained,
    })),
    {
      key: "custom" as OptionKey,
      label: "Custom",
      schemeSummary: describeStandard(customScheme.standard),
      metrics: customEval,
    },
  ];

  const orderCount = currentFacts?.orderCount ?? 0;
  const anyUnconstrained = (recs ?? []).some((r) => r.unconstrained);

  const metricRows: {
    label: string;
    render: (m: OptionMetrics, isBaseline: boolean) => string;
    show?: boolean;
  }[] = [
    {
      label: "Δ total contribution",
      render: (m, base) => (base ? "—" : signedCurrency(m.contributionDelta)),
    },
    {
      label: "Δ net shipping profit",
      render: (m, base) => (base ? "—" : signedCurrency(m.netShippingProfitDelta)),
    },
    {
      label: "Basket margin gain",
      render: (m, base) => (base || m.upliftMarginGain === 0 ? "—" : signedCurrency(m.upliftMarginGain)),
    },
    {
      label: "Abandonment margin loss",
      render: (m, base) => (base || m.abandonMarginLoss === 0 ? "—" : signedCurrency(-m.abandonMarginLoss)),
    },
    {
      label: "Expected orders lost",
      render: (m, base) => (base ? "—" : m.expectedOrdersLost.toFixed(1)),
    },
    {
      label: "Free-order share",
      render: (m) => formatPercent(m.freeOrderShare),
    },
    {
      label: "Cost recovery",
      render: (m) => formatPercent(m.recoveryRate),
    },
    {
      label: "Monthly Δ (illustrative)",
      render: (m, base) =>
        base || orderCount === 0 || monthlyOrders === undefined
          ? "—"
          : signedCurrency((m.contributionDelta / orderCount) * monthlyOrders),
      show: monthlyOrders !== undefined,
    },
    {
      label: "Annual Δ (illustrative)",
      render: (m, base) =>
        base || orderCount === 0 || monthlyOrders === undefined
          ? "—"
          : signedCurrency((m.contributionDelta / orderCount) * monthlyOrders * 12),
      show: monthlyOrders !== undefined,
    },
  ];

  const assumptionEcho = `Assumptions: ${Math.round(upliftRate * 100)}% of orders within $${upliftWindow} below the threshold build baskets (Basket-builder only); ${Math.round(abandonRate * 100)}% of worse-off orders abandon; COGS ${Math.round((cogsPercent ?? 0) * 100)}%. Deltas are expected values vs the observed current baseline over ${orderCount} orders.`;

  const tabs: { key: OptionKey; label: string }[] = [
    { key: "profit-first", label: "Profit-first" },
    { key: "threshold-fee", label: "Optimised threshold + fee" },
    { key: "basket-builder", label: "Basket-builder" },
    { key: "custom", label: "Custom" },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-tac-accent">Scheme options — side-by-side</h3>

      {/* Assumptions panel */}
      <div className="card no-print">
        <p className="text-sm text-tac-muted mb-3">
          Behavioural assumptions. Every number in the table shows its inputs — drag these to
          stress-test all options at once.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <InputField
            label="COGS %"
            value={toPercent(cogsPercent ?? 0)}
            onChange={(v) => onCogsChange(v / 100)}
            suffix="%"
            step={1}
            min={0}
            max={100}
            tooltip="Required — values the product margin gained by basket-building and lost to abandonment"
          />
          <InputField
            label="Basket uplift"
            value={toPercent(upliftRate)}
            onChange={(v) => onUpliftRateChange(v / 100)}
            suffix="%"
            step={5}
            min={0}
            max={100}
            tooltip="Share of orders just below the threshold that add items to qualify"
          />
          <InputField
            label="Uplift window"
            value={upliftWindow}
            onChange={onUpliftWindowChange}
            prefix="$"
            step={5}
            min={0}
            tooltip="How far below the threshold an order can be and still build to it"
          />
          <InputField
            label="Abandonment"
            value={toPercent(abandonRate)}
            onChange={(v) => onAbandonRateChange(v / 100)}
            suffix="%"
            step={1}
            min={0}
            max={100}
            tooltip="Share of orders facing a higher shipping cost than today that abandon"
          />
        </div>
      </div>

      {cogsPercent === undefined ? (
        <div className="card no-print">
          <p className="text-sm text-tac-warning">
            Enter a COGS % above to unlock the side-by-side comparison — without it,
            basket-building gains and abandonment losses can&apos;t be valued.
          </p>
        </div>
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-tac-border text-tac-muted">
                  <th className="text-left py-2 pr-3 font-normal">Metric</th>
                  {columns.map((col) => (
                    <th key={col.key} className="text-right py-2 px-3">
                      <span className={col.isBaseline ? "text-tac-muted" : "text-tac-accent"}>
                        {col.label}
                        {col.unconstrained && <span title="Optimum may be unreliable at 0% abandonment">*</span>}
                      </span>
                    </th>
                  ))}
                </tr>
                <tr className="border-b border-tac-border/50 text-xs text-tac-muted">
                  <td className="py-1 pr-3">Standard tier</td>
                  {columns.map((col) => (
                    <td key={col.key} className="text-right py-1 px-3">{col.schemeSummary}</td>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metricRows
                  .filter((row) => row.show !== false)
                  .map((row) => (
                    <tr key={row.label} className="border-b border-tac-border/30">
                      <td className="py-2 pr-3 text-tac-muted">{row.label}</td>
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={`text-right py-2 px-3 ${
                            row.label === "Δ total contribution" && !col.isBaseline
                              ? "font-semibold text-tac-accent"
                              : ""
                          }`}
                        >
                          {col.metrics ? row.render(col.metrics, col.isBaseline === true) : "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
            <p className="text-xs text-tac-muted mt-3">{assumptionEcho}</p>
            {anyUnconstrained && (
              <p className="text-xs text-tac-warning mt-1">
                * Abandonment is 0% — nothing stops &quot;charge everyone more&quot;, so this
                optimum may be unreliable. Set an abandonment rate before trusting it.
              </p>
            )}
          </div>

          {/* Drill-down selector */}
          <div className="flex flex-wrap gap-2 no-print">
            <span className="text-sm text-tac-muted self-center">Drill into:</span>
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`text-sm py-1.5 px-3 rounded-lg border ${
                  selected === tab.key
                    ? "border-tac-accent text-tac-accent"
                    : "border-tac-border text-tac-muted hover:border-tac-accent/50"
                }`}
                disabled={tab.key !== "custom" && (recs === null || recs.length === 0)}
                onClick={() => onSelect(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
