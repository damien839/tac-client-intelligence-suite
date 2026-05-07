"use client";

import { useState, useMemo, useEffect } from "react";
import Nav from "@/components/shared/Nav";
import CsvUploader from "@/components/shared/CsvUploader";
import InputField from "@/components/shared/InputField";
import MetricCard from "@/components/shared/MetricCard";
import { parseWarehouseCost, WarehouseCostRow } from "@/lib/csvParsers";
import { warehouseBenchmarks, scoreBenchmark, BenchmarkCategory } from "@/lib/benchmarks";
import { formatCurrency } from "@/lib/calculations";

export default function WarehousePage() {
  const [, setWarehouseData] = useState<WarehouseCostRow[]>([]);

  const [monthlyOrders, setMonthlyOrders] = useState(5000);

  const [whBenchmarks] = useState<BenchmarkCategory[]>(warehouseBenchmarks);

  const [clientMetrics, setClientMetrics] = useState<Record<string, number>>({
    receiving: 30,
    putaway: 25,
    pick_pack: 20,
    cost_per_order: 6.0,
    accuracy: 99.2,
  });

  const handleWarehouseUpload = (csvText: string) => {
    const result = parseWarehouseCost(csvText);
    setWarehouseData(result.rows);
  };

  const warehouseScorecard = useMemo(() => {
    return whBenchmarks.map((bm) => {
      const clientValue = clientMetrics[bm.id] || 0;
      const isLowerBetter = bm.id === "cost_per_order";
      const score = scoreBenchmark(clientValue, bm, isLowerBetter);
      const gapLow = clientValue - bm.low;
      const gapHigh = clientValue - bm.high;
      return { ...bm, clientValue, score, gapLow, gapHigh };
    });
  }, [whBenchmarks, clientMetrics]);

  const totalWarehouseSavings = useMemo(() => {
    const costBm = whBenchmarks.find((b) => b.id === "cost_per_order");
    if (!costBm) return 0;
    const clientCost = clientMetrics.cost_per_order || 0;
    const targetCost = (costBm.low + costBm.high) / 2;
    const gap = clientCost - targetCost;
    return gap > 0 ? gap * monthlyOrders * 12 : 0;
  }, [whBenchmarks, clientMetrics, monthlyOrders]);

  useEffect(() => {
    const profile = JSON.parse(localStorage.getItem("tac-client-profile") || "{}");
    const gaps = warehouseScorecard
      .filter((row) => row.score !== "green")
      .sort((a, b) => {
        if (a.score === "red" && b.score !== "red") return -1;
        if (a.score !== "red" && b.score === "red") return 1;
        return 0;
      })
      .slice(0, 3)
      .map((row) => `${row.label}: ${row.clientValue} ${row.unit} (benchmark: ${row.low}–${row.high} ${row.unit})`);
    localStorage.setItem(
      "tac_warehouse_results",
      JSON.stringify({
        timestamp: new Date().toISOString(),
        clientName: profile.clientName || "",
        warehouseSavings: totalWarehouseSavings,
        topBenchmarkGaps: gaps,
        monthlyOrders,
      })
    );
  }, [totalWarehouseSavings, warehouseScorecard, monthlyOrders]);

  const scoreColor = (score: "green" | "amber" | "red") => {
    switch (score) {
      case "green": return "text-tac-success";
      case "amber": return "text-tac-warning";
      case "red": return "text-tac-danger";
    }
  };

  const scoreBg = (score: "green" | "amber" | "red") => {
    switch (score) {
      case "green": return "bg-tac-success/10";
      case "amber": return "bg-tac-warning/10";
      case "red": return "bg-tac-danger/10";
    }
  };

  return (
    <>
      <Nav />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-2">Warehouse Cost Audit</h1>
        <p className="text-tac-muted mb-8">
          Benchmark warehouse efficiency and cost-per-order against TAC standards.
        </p>

        {totalWarehouseSavings > 0 && (
          <div className="card border-tac-accent/50 bg-tac-accent/5 mb-8 text-center py-8">
            <p className="text-tac-muted text-sm mb-1">Annual Warehouse Savings Opportunity</p>
            <p className="text-5xl font-bold text-tac-accent">
              {formatCurrency(totalWarehouseSavings, 0)}
            </p>
            <p className="text-tac-muted text-sm mt-2">per year</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <CsvUploader
            label="Upload Warehouse Cost CSV"
            description="Columns: Category, Monthly Cost, Per Unit Cost"
            onUpload={handleWarehouseUpload}
          />
          <div className="card">
            <h3 className="text-lg font-semibold mb-4 text-tac-accent">Volume</h3>
            <InputField
              label="Monthly Order Volume"
              value={monthlyOrders}
              onChange={setMonthlyOrders}
              step={100}
              min={0}
            />
          </div>
        </div>

        <div className="card mb-8">
          <h3 className="text-lg font-semibold mb-4 text-tac-accent">
            Client Warehouse Metrics
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {whBenchmarks.map((bm) => (
              <InputField
                key={bm.id}
                label={`${bm.label} (${bm.unit})`}
                value={clientMetrics[bm.id] || 0}
                onChange={(v) =>
                  setClientMetrics((prev) => ({ ...prev, [bm.id]: v }))
                }
                step={bm.id === "accuracy" ? 0.1 : 1}
                min={0}
              />
            ))}
          </div>
        </div>

        <div className="card mb-8">
          <h3 className="text-lg font-semibold mb-4 text-tac-accent">
            Warehouse Efficiency Scorecard
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-tac-border text-tac-muted">
                <th className="text-left py-2 pr-4">Metric</th>
                <th className="text-right py-2 px-3">Client</th>
                <th className="text-right py-2 px-3">Benchmark (Low)</th>
                <th className="text-right py-2 px-3">Benchmark (High)</th>
                <th className="text-center py-2 px-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {warehouseScorecard.map((row) => (
                <tr key={row.id} className="border-b border-tac-border/50">
                  <td className="py-2 pr-4">
                    <span className="font-medium">{row.label}</span>
                    <br />
                    <span className="text-xs text-tac-muted">{row.description}</span>
                  </td>
                  <td className="text-right px-3 font-semibold">
                    {row.clientValue} {row.unit}
                  </td>
                  <td className="text-right px-3 text-tac-muted">
                    {row.low} {row.unit}
                  </td>
                  <td className="text-right px-3 text-tac-muted">
                    {row.high} {row.unit}
                  </td>
                  <td className="text-center px-3">
                    <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${scoreBg(row.score)} ${scoreColor(row.score)}`}>
                      {row.score === "green" ? "✓ Good" : row.score === "amber" ? "● Acceptable" : "✗ Below"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <MetricCard
            label="Monthly Order Volume"
            value={monthlyOrders.toLocaleString()}
          />
          <MetricCard
            label="Annual Savings Opportunity"
            value={formatCurrency(totalWarehouseSavings, 0)}
            accent={totalWarehouseSavings > 0}
          />
        </div>
      </main>
    </>
  );
}
