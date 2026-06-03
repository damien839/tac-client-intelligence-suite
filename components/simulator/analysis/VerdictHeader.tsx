"use client";

import MetricCard from "@/components/shared/MetricCard";
import { Analysis } from "@/lib/shipping-sim/types";
import { formatCurrency, formatPercent } from "@/lib/calculations";
import { goodIfNegative, goodIfPositive, signedCurrency } from "./format";

interface VerdictHeaderProps {
  analysis: Analysis;
}

export default function VerdictHeader({ analysis }: VerdictHeaderProps) {
  const { benchmark, recoveryCurrent, recoveryProposed, movedCount, movement } = analysis;
  const adopt = benchmark.netProfitDelta > 0;
  const baseNet = Math.abs(benchmark.current.netShippingProfit);
  const improvePct = baseNet > 0 ? Math.abs(benchmark.netProfitDelta) / baseNet : 0;

  return (
    <div>
      <div className="rounded-xl border border-tac-accent/35 bg-tac-accent/5 p-5 mb-5">
        <span
          className={`inline-block text-xs font-bold tracking-wide px-2.5 py-1 rounded-full mb-2 ${
            adopt ? "bg-tac-success text-tac-bg" : "bg-tac-warning text-tac-bg"
          }`}
        >
          {adopt ? "RECOMMEND: ADOPT" : "RECOMMEND: REVISE"}
        </span>
        <p className="text-base leading-relaxed">
          <strong>
            {adopt
              ? "Adopt the proposed scheme."
              : "Hold — the proposal reduces shipping profit."}
          </strong>{" "}
          Net shipping P&amp;L moves {signedCurrency(benchmark.netProfitDelta)} across{" "}
          {movement.length} orders ({formatPercent(improvePct)} {adopt ? "improvement" : "worse"}),
          driven mostly by carrier savings of {formatCurrency(-benchmark.carrierSpendDelta)} as{" "}
          {movedCount} express order{movedCount === 1 ? "" : "s"} shift to standard.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Net shipping P&L"
          value={signedCurrency(benchmark.netProfitDelta)}
          trend={goodIfPositive(benchmark.netProfitDelta)}
          trendValue={`${formatPercent(improvePct)} vs now`}
        />
        <MetricCard
          label="Cost recovery"
          value={formatPercent(recoveryProposed, 0)}
          trend={goodIfPositive(recoveryProposed - recoveryCurrent)}
          trendValue={`from ${formatPercent(recoveryCurrent, 0)}`}
        />
        <MetricCard
          label="Carrier spend"
          value={signedCurrency(benchmark.carrierSpendDelta)}
          trend={goodIfNegative(benchmark.carrierSpendDelta)}
          trendValue="lower outlay"
        />
        <MetricCard
          label="Orders reshuffled"
          value={`${movedCount} / ${movement.length}`}
          trend="neutral"
          trendValue="express → standard"
          accent
        />
      </div>
    </div>
  );
}
