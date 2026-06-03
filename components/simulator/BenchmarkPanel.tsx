"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import MetricCard from "@/components/shared/MetricCard";
import { Benchmark, CANONICAL_TIERS, TIER_LABELS } from "@/lib/shipping-sim/types";
import { formatCurrency, formatPercent } from "@/lib/calculations";

interface BenchmarkPanelProps {
  benchmark: Benchmark;
}

export default function BenchmarkPanel({ benchmark }: BenchmarkPanelProps) {
  const { current, proposed, reconciliation } = benchmark;

  const mixData = CANONICAL_TIERS.filter(
    (t) => current.ordersByTier[t] > 0 || proposed.ordersByTier[t] > 0
  ).map((t) => ({
    tier: TIER_LABELS[t],
    Current: current.ordersByTier[t],
    Proposed: proposed.ordersByTier[t],
  }));

  const reconHigh = reconciliation.variancePct > 0.1;

  return (
    <div className="space-y-6">
      {/* Reconciliation badge */}
      <div
        className={`p-3 rounded-lg border text-sm ${
          reconHigh
            ? "bg-tac-danger/10 border-tac-danger/30 text-tac-danger"
            : "bg-tac-success/10 border-tac-success/30 text-tac-success"
        }`}
      >
        Current-scheme model reproduces {formatPercent(Math.max(0, 1 - reconciliation.variancePct))} of actual
        shipping revenue ({formatCurrency(reconciliation.modelledCurrentRevenue)} modelled vs{" "}
        {formatCurrency(reconciliation.actualShippingPaid)} actual).
        {reconHigh && " High variance — re-check the current scheme before trusting the proposal."}
      </div>

      {/* Headline deltas */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <MetricCard
          label="Δ Shipping Revenue"
          value={formatCurrency(benchmark.shippingRevenueDelta)}
        />
        <MetricCard label="Δ Carrier Spend" value={formatCurrency(benchmark.carrierSpendDelta)} />
        <MetricCard label="Net Profit Δ" value={formatCurrency(benchmark.netProfitDelta)} accent />
      </div>

      {/* Current vs proposed table */}
      <div className="card overflow-x-auto">
        <h3 className="text-lg font-semibold mb-4 text-tac-accent">Current vs Proposed</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-tac-border text-tac-muted">
              <th className="text-left py-2">Metric</th>
              <th className="text-right py-2 px-3">Current</th>
              <th className="text-right py-2 px-3">Proposed</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-tac-border/50">
              <td className="py-2">Shipping revenue</td>
              <td className="text-right px-3">{formatCurrency(current.shippingRevenue)}</td>
              <td className="text-right px-3">{formatCurrency(proposed.shippingRevenue)}</td>
            </tr>
            <tr className="border-b border-tac-border/50">
              <td className="py-2">Carrier spend</td>
              <td className="text-right px-3">{formatCurrency(current.carrierSpend)}</td>
              <td className="text-right px-3">{formatCurrency(proposed.carrierSpend)}</td>
            </tr>
            <tr>
              <td className="py-2 font-semibold">Net shipping profit</td>
              <td className="text-right px-3 font-semibold">{formatCurrency(current.netShippingProfit)}</td>
              <td className="text-right px-3 font-semibold">{formatCurrency(proposed.netShippingProfit)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Tier mix shift */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4 text-tac-accent">Carrier mix shift</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={mixData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2D4050" />
            <XAxis dataKey="tier" tick={{ fontSize: 12, fill: "#A0AEB8" }} />
            <YAxis tick={{ fontSize: 11, fill: "#A0AEB8" }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1F3040",
                border: "1px solid #2D4050",
                borderRadius: 8,
                color: "#fff",
              }}
            />
            <Legend />
            <Bar dataKey="Current" fill="#A0AEB8" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Proposed" fill="#F5B36B" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {benchmark.cogsContext && (
        <div className="card">
          <h3 className="text-lg font-semibold mb-2 text-tac-accent">Full-margin context</h3>
          <p className="text-sm text-tac-muted">
            Gross product margin at {formatPercent(benchmark.cogsContext.cogsPercent)} COGS:{" "}
            {formatCurrency(benchmark.cogsContext.grossProductMargin)}. This is identical in both
            scenarios — cart sizes don&apos;t change — so it does not affect the profit delta above.
          </p>
        </div>
      )}
    </div>
  );
}
