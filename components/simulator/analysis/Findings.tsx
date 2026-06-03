"use client";

import { Analysis } from "@/lib/shipping-sim/types";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/calculations";
import { signedCurrency } from "./format";

interface FindingsProps {
  analysis: Analysis;
  monthlyOrders?: number; // optional, for the illustrative scaling line
}

export default function Findings({ analysis, monthlyOrders }: FindingsProps) {
  const {
    benchmark,
    recoveryCurrent,
    recoveryProposed,
    subsidyCurrent,
    subsidyProposed,
    freeOrdersCurrent,
    optimalThreshold,
    optimalNet,
    movedCount,
    movement,
    netDeltaPerOrder,
  } = analysis;

  const adopt = benchmark.netProfitDelta > 0;
  const baseNet = Math.abs(benchmark.current.netShippingProfit);
  const improvePct = baseNet > 0 ? Math.abs(benchmark.netProfitDelta) / baseNet : 0;
  const n = movement.length;

  const findings: string[] = [
    `${adopt ? "Adopt the proposed scheme." : "Hold — the proposal reduces shipping profit."} Net shipping P&L moves ${signedCurrency(benchmark.netProfitDelta)} across ${n} orders (${formatPercent(improvePct)} ${adopt ? "improvement" : "worse"}), mostly from ${formatCurrency(-benchmark.carrierSpendDelta)} of carrier savings as ${movedCount} express order${movedCount === 1 ? "" : "s"} shift to standard.`,
    `Cost recovery climbs ${formatPercent(recoveryCurrent, 0)} → ${formatPercent(recoveryProposed, 0)}. You ${recoveryProposed < 1 ? "still under-recover" : "now cover"} carrier cost at the proposed rates.`,
    `Free-shipping subsidy: ${formatCurrency(subsidyCurrent)} → ${formatCurrency(subsidyProposed)}. ${freeOrdersCurrent} of ${n} orders ship free today, costing carrier fees you collect nothing against.`,
    `Profit-maximising standard threshold ≈ $${optimalThreshold}, peaking at ${formatCurrency(optimalNet)} net shipping profit.${benchmark.proposed.netShippingProfit < 0 ? " Even at the optimum, shipping runs at a managed loss — a deliberate AOV/conversion lever, not a profit centre." : ""}`,
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-3 text-tac-accent">Findings &amp; recommendation</h3>
        <ul className="space-y-2.5 list-none p-0 m-0">
          {findings.map((f, i) => (
            <li
              key={i}
              className="card border-l-2 border-l-tac-accent text-sm"
            >
              {f}
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold mb-2 text-tac-accent">
          Scaled impact{" "}
          <span className="text-xs font-normal text-tac-muted">(illustrative)</span>
        </h3>
        <p className="text-sm mb-1">
          Net shipping P&amp;L improvement per order:{" "}
          <strong className="text-tac-success">{signedCurrency(netDeltaPerOrder)}</strong> (
          {signedCurrency(benchmark.netProfitDelta)} ÷ {n} orders).
        </p>
        {monthlyOrders && monthlyOrders > 0 ? (
          <p className="text-sm text-tac-muted">
            At <strong className="text-tac-text">{formatNumber(monthlyOrders)}</strong> orders/month
            that scales to ≈{" "}
            <strong className="text-tac-success">
              {formatCurrency(netDeltaPerOrder * monthlyOrders, 0)}/month
            </strong>{" "}
            ·{" "}
            <strong className="text-tac-success">
              {formatCurrency(netDeltaPerOrder * monthlyOrders * 12, 0)}/year
            </strong>
            . Volume is your input; the sample mix is assumed representative.
          </p>
        ) : (
          <p className="text-sm text-tac-muted">
            Enter the client&apos;s monthly order volume above to project the monthly and annual impact.
          </p>
        )}
      </div>
    </div>
  );
}
