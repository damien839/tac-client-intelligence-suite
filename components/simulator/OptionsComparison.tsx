"use client";

import InputField from "@/components/shared/InputField";
import {
  CANONICAL_TIERS,
  CanonicalTier,
  Scheme,
  SchemeEvaluation,
  TIER_LABELS,
} from "@/lib/shipping-sim/types";
import { formatCurrency, formatPercent } from "@/lib/calculations";
import { describeStandard, signedCurrency } from "./analysis/format";
import { ReportOption } from "./report/types";

interface OptionsComparisonProps {
  /** The evaluated options (recommendations + Custom) — same data that drives the report below. */
  options: ReportOption[];
  currentFacts: SchemeEvaluation | null; // current scheme vs itself, behaviour zeroed
  currentScheme: Scheme;
  customScheme: Scheme;
  /** True when recommendations were computed but came back empty (current scheme has no standard tier). */
  recsEmpty: boolean;
  cogsPercent: number | undefined;
  monthlyOrders: number | undefined;
  upliftRate: number;
  upliftWindow: number;
  abandonRate: number;
  /** Printed assumptions line — built by the parent from the deferred values the table metrics were actually computed from, and shared with the report below. */
  assumptionEcho: string;
  onCogsChange: (value: number | undefined) => void;
  onUpliftRateChange: (value: number) => void;
  onUpliftWindowChange: (value: number) => void;
  onAbandonRateChange: (value: number) => void;
}

/** One table column: Current (baseline facts) or an evaluated option. */
interface Column {
  key: string;
  label: string;
  evaluation: SchemeEvaluation | null;
  isBaseline: boolean;
  unconstrained?: boolean;
  option?: ReportOption;
}

/** One table body row — renders a string per column from its evaluation. */
interface BodyRow {
  key: string;
  label: string;
  tooltip: string;
  emphasize?: boolean;
  render: (evaluation: SchemeEvaluation, isBaseline: boolean) => string;
}

/** Fraction -> percent for display, rounded to 0.1 to hide float artifacts (0.55 -> 55, not 55.00000000000001). */
function toPercent(fraction: number): number {
  return Math.round(fraction * 1000) / 10;
}

/** EV-weighted order count: whole number when integral after rounding to 1dp, else 1dp. */
function formatVolume(count: number): string {
  const rounded = Math.round(count * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export default function OptionsComparison({
  options,
  currentFacts,
  currentScheme,
  customScheme,
  recsEmpty,
  cogsPercent,
  monthlyOrders,
  upliftRate,
  upliftWindow,
  abandonRate,
  assumptionEcho,
  onCogsChange,
  onUpliftRateChange,
  onUpliftWindowChange,
  onAbandonRateChange,
}: OptionsComparisonProps) {
  const columns: Column[] = [
    {
      key: "current",
      label: "Current",
      evaluation: currentFacts,
      isBaseline: true,
    },
    ...options.map((option) => ({
      key: option.key,
      label: option.label,
      evaluation: option.evaluation,
      isBaseline: false,
      unconstrained: option.unconstrained,
      option,
    })),
  ];

  const usedTiers: CanonicalTier[] = CANONICAL_TIERS.filter(
    (tier) => currentScheme[tier] !== undefined || customScheme[tier] !== undefined
  );
  const hasNonStandardTiers = usedTiers.some((tier) => tier !== "standard");

  const orderCount = currentFacts?.orderCount ?? 0;
  const anyUnconstrained = options.some((option) => option.unconstrained);

  /**
   * Per-tier scheme summary for a column. Recommendations only optimise the standard
   * tier — every non-standard tier stays at current pricing for them; only Custom
   * carries its own per-tier configuration.
   */
  function schemeCell(col: Column, tier: CanonicalTier): string {
    if (tier === "standard") {
      return col.isBaseline ? describeStandard(currentScheme.standard) : col.option?.schemeSummary ?? "—";
    }
    if (col.option?.key === "custom") return describeStandard(customScheme[tier]);
    return describeStandard(currentScheme[tier]);
  }

  const volumeRows: BodyRow[] = usedTiers.map((tier) => ({
    key: `volume-${tier}`,
    label: `${TIER_LABELS[tier]} volume`,
    tooltip: "Orders expected to ship on this service",
    render: (evaluation) => {
      const count = evaluation.volumeByTier[tier];
      const total = usedTiers.reduce((sum, t) => sum + evaluation.volumeByTier[t], 0);
      const share = total > 0 ? ` (${formatPercent(count / total)})` : "";
      return `${formatVolume(count)}${share}`;
    },
  }));

  const carrierSpendRow: BodyRow = {
    key: "carrier-spend",
    label: "Carrier spend",
    tooltip: "Total expected carrier cost; bracketed figure is the change vs current",
    render: (evaluation, base) =>
      base || !currentFacts
        ? formatCurrency(evaluation.carrierSpend)
        : `${formatCurrency(evaluation.carrierSpend)} (${signedCurrency(
            evaluation.carrierSpend - currentFacts.carrierSpend
          )})`,
  };

  const metricRows: BodyRow[] = [
    {
      key: "contribution",
      label: "Δ total contribution",
      tooltip:
        "The bottom line for the period uploaded: shipping P&L plus product margin gained from bigger baskets, minus margin lost to abandoned orders — after customers react.",
      render: (m, base) => (base ? "—" : signedCurrency(m.contributionDelta)),
      emphasize: true,
    },
    {
      key: "net-shipping",
      label: "Δ net shipping profit",
      tooltip: "Shipping fees collected minus carrier costs, versus current.",
      render: (m, base) => (base ? "—" : signedCurrency(m.netShippingProfitDelta)),
    },
    {
      key: "basket-gain",
      label: "Basket margin gain",
      tooltip: "Extra product margin from customers adding items to reach the free-shipping threshold.",
      render: (m, base) => (base || m.upliftMarginGain === 0 ? "—" : signedCurrency(m.upliftMarginGain)),
    },
    {
      key: "abandon-loss",
      label: "Abandonment margin loss",
      tooltip: "Product margin lost from customers who abandon because shipping got more expensive.",
      render: (m, base) => (base || m.abandonMarginLoss === 0 ? "—" : signedCurrency(-m.abandonMarginLoss)),
    },
    {
      key: "orders-lost",
      label: "Expected orders lost",
      tooltip: "Orders expected to abandon (modelled average, not a prediction of specific orders).",
      render: (m, base) => (base ? "—" : m.expectedOrdersLost.toFixed(1)),
    },
    {
      key: "free-share",
      label: "Free-order share",
      tooltip: "Share of completing orders that ship free.",
      render: (m) => formatPercent(m.freeOrderShare),
    },
    {
      key: "recovery",
      label: "Cost recovery",
      tooltip: "Shipping fees collected as a share of carrier cost — 100% means customers fully fund shipping.",
      render: (m) => formatPercent(m.recoveryRate),
    },
    ...(monthlyOrders !== undefined
      ? [
          {
            key: "monthly",
            label: "Monthly Δ (illustrative)",
            tooltip: "Per-order contribution × your monthly volume. Illustrative only.",
            render: (m: SchemeEvaluation, base: boolean) =>
              base || orderCount === 0
                ? "—"
                : signedCurrency((m.contributionDelta / orderCount) * (monthlyOrders ?? 0)),
          },
          {
            key: "annual",
            label: "Annual Δ (illustrative)",
            tooltip: "Per-order contribution × your monthly volume. Illustrative only.",
            render: (m: SchemeEvaluation, base: boolean) =>
              base || orderCount === 0
                ? "—"
                : signedCurrency((m.contributionDelta / orderCount) * (monthlyOrders ?? 0) * 12),
          },
        ]
      : []),
  ];

  const bodyRows: BodyRow[] = [...volumeRows, carrierSpendRow, ...metricRows];

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
            label="Abandonment / $10"
            value={toPercent(abandonRate)}
            onChange={(v) => onAbandonRateChange(v / 100)}
            suffix="%"
            step={1}
            min={0}
            max={100}
            tooltip="Share of affected orders that abandon for every $10 their shipping cost rises (capped at 100%). Example: at 10%, a $5 rise loses 5% of those orders; a $30 rise loses 30%."
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
            <p className="text-sm text-tac-muted mb-3">
              Each column is a pricing option for your standard shipping; each row is a
              consequence. Current is what your uploaded orders actually did. The three
              recommendations come from testing thousands of threshold-and-fee combinations
              against your orders; Custom is the scheme entered below the table. Read across a
              row to compare options.
            </p>
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
                {usedTiers.map((tier) => (
                  <tr key={tier} className="border-b border-tac-border/50 text-xs text-tac-muted">
                    <td className="py-1 pr-3">{TIER_LABELS[tier]} scheme</td>
                    {columns.map((col) => (
                      <td key={col.key} className="text-right py-1 px-3">{schemeCell(col, tier)}</td>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {bodyRows.map((row) => (
                  <tr key={row.key} className="border-b border-tac-border/30">
                    <td className="py-2 pr-3 text-tac-muted" title={row.tooltip}>
                      {row.label}
                      <span className="ml-1 text-tac-accent cursor-help" title={row.tooltip}>ⓘ</span>
                    </td>
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`text-right py-2 px-3 ${
                          row.emphasize && !col.isBaseline ? "font-semibold text-tac-accent" : ""
                        }`}
                      >
                        {col.evaluation ? row.render(col.evaluation, col.isBaseline) : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-tac-muted mt-3">{assumptionEcho}</p>
            {hasNonStandardTiers && (
              <p className="text-xs text-tac-muted mt-1">
                Recommendations never alter non-standard tiers — those services stay at their
                current pricing in every recommended option; only the Custom scheme can change
                them.
              </p>
            )}
            {anyUnconstrained && (
              <p className="text-xs text-tac-warning mt-1">
                * Abandonment is 0% — nothing stops &quot;charge everyone more&quot;, so this
                optimum may be unreliable. Set an abandonment rate before trusting it.
              </p>
            )}
          </div>

          {recsEmpty && (
            <div className="card no-print">
              <p className="text-sm text-tac-muted">
                Recommendations target the standard free-over line — map a service to Standard to
                enable the three recommended options. The table compares Current vs Custom only.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
