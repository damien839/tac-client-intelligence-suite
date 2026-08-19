"use client";

import { CANONICAL_TIERS, Scheme, SchemeEvaluation } from "@/lib/shipping-sim/types";
import { formatPercent } from "@/lib/calculations";
import { describeChangedTiers, describeStandard, signedCurrency } from "./analysis/format";
import { MECHANICAL_CAVEAT, ReportOption } from "./report/types";

/** Human summary of the row's scheme: the whole scheme for Current, the diff otherwise. */
function describeScheme(option: ReportOption, currentScheme: Scheme): string {
  if (option.id === "current") {
    return CANONICAL_TIERS.filter((tier) => currentScheme[tier] !== undefined)
      .map((tier) => describeStandard(currentScheme[tier]))
      .join(" · ");
  }
  return describeChangedTiers(option.scheme, option.changedTiers);
}

interface OptionsComparisonProps {
  /** Evaluated candidate rows — Current first, then ordered by net shipping P&L delta. */
  options: ReportOption[];
  currentScheme: Scheme;
  /** True when candidates were built but came back empty (no analysable orders). */
  candidatesEmpty: boolean;
  monthlyOrders: number | undefined;
}

/** One numeric column of the grid. */
interface GridColumn {
  key: string;
  label: string;
  tooltip: string;
  emphasize?: boolean;
  render: (evaluation: SchemeEvaluation, isCurrent: boolean) => string;
}

/** Per-order figure scaled to a monthly / annual volume. */
function scaled(value: number, evaluation: SchemeEvaluation, orders: number, months: number): string {
  if (evaluation.orderCount === 0) return "—";
  return signedCurrency((value / evaluation.orderCount) * orders * months);
}

export default function OptionsComparison({
  options,
  currentScheme,
  candidatesEmpty,
  monthlyOrders,
}: OptionsComparisonProps) {
  const columns: GridColumn[] = [
    {
      key: "fee-revenue",
      label: "Fee revenue Δ",
      tooltip:
        "Change in shipping fees collected, over the same orders you uploaded. Moves when a different share of orders sits above or below the free-shipping line.",
      render: (e, isCurrent) => (isCurrent ? "—" : signedCurrency(e.shippingRevenueDelta)),
    },
    {
      key: "carrier-cost",
      label: "Carrier cost Δ",
      tooltip:
        "Change in what the carriers bill you. Only moves when orders land on a different service tier under the new scheme — the same orders otherwise cost the same to ship.",
      render: (e, isCurrent) => (isCurrent ? "—" : signedCurrency(e.carrierSpendDelta)),
    },
    {
      key: "recovery",
      label: "Cost recovery",
      tooltip:
        "Shipping fees collected as a share of carrier cost — 100% means customers fully fund shipping. Shown as current → proposed.",
      render: (e, isCurrent) =>
        isCurrent
          ? formatPercent(e.recoveryRateCurrent)
          : `${formatPercent(e.recoveryRateCurrent)} → ${formatPercent(e.recoveryRate)}`,
    },
    {
      key: "net",
      label: "Net shipping P&L Δ",
      tooltip: "Fee revenue Δ minus carrier cost Δ, versus the current scheme.",
      emphasize: true,
      render: (e, isCurrent) => (isCurrent ? "—" : signedCurrency(e.netShippingProfitDelta)),
    },
    ...(monthlyOrders !== undefined
      ? [
          {
            key: "monthly",
            label: "Monthly Δ (illustrative)",
            tooltip:
              "Net shipping P&L Δ per order × your monthly volume. Illustrative scaling of the uploaded sample only.",
            render: (e: SchemeEvaluation, isCurrent: boolean) =>
              isCurrent ? "—" : scaled(e.netShippingProfitDelta, e, monthlyOrders, 1),
          },
          {
            key: "annual",
            label: "Annual Δ (illustrative)",
            tooltip:
              "Net shipping P&L Δ per order × your monthly volume × 12. Illustrative scaling of the uploaded sample only.",
            render: (e: SchemeEvaluation, isCurrent: boolean) =>
              isCurrent ? "—" : scaled(e.netShippingProfitDelta, e, monthlyOrders, 12),
          },
        ]
      : []),
  ];

  const orderCount = options[0]?.evaluation.orderCount ?? 0;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-tac-accent">Candidate comparison</h3>

      {candidatesEmpty || options.length === 0 ? (
        <div className="card">
          <p className="text-sm text-tac-muted">
            No candidates — none of the uploaded orders map to a service in the current scheme.
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <p className="text-sm text-tac-muted mb-3">
            Each row re-prices the {orderCount} orders you uploaded under a different scheme, then
            reports what changes. Nothing here is a recommendation: rows are ordered by net
            shipping P&amp;L so the spread is easy to read, and the current scheme stays pinned at
            the top as the baseline every delta is measured against.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-tac-border text-tac-muted">
                <th className="text-left py-2 pr-3 font-normal">Option</th>
                <th className="text-left py-2 px-3 font-normal">Scheme</th>
                {columns.map((column) => (
                  <th key={column.key} className="text-right py-2 px-3 font-normal" title={column.tooltip}>
                    {column.label}
                    <span className="ml-1 text-tac-accent cursor-help" title={column.tooltip}>ⓘ</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {options.map((option) => (
                <tr key={option.id} className="border-b border-tac-border/30">
                  <td className="py-2 pr-3">
                    <span style={{ color: option.color }}>{option.label}</span>
                    {option.isCurrent && option.id !== "current" && (
                      <span
                        className="block text-xs text-tac-muted"
                        title="This candidate is identical to the current scheme"
                      >
                        = current
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-xs text-tac-muted">
                    {describeScheme(option, currentScheme)}
                  </td>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`text-right py-2 px-3 ${
                        column.emphasize && !option.isCurrent ? "font-semibold text-tac-accent" : ""
                      }`}
                    >
                      {column.render(option.evaluation, option.isCurrent)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-tac-warning mt-3">{MECHANICAL_CAVEAT}</p>
          <p className="text-xs text-tac-muted mt-1">
            Competitor benchmark assumes your product pricing (RRP) is comparable — if their RRP
            differs, the comparison is not like-for-like.
          </p>
        </div>
      )}
    </div>
  );
}
