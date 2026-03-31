"use client";

import { useState, useMemo } from "react";
import Nav from "@/components/shared/Nav";
import CsvUploader from "@/components/shared/CsvUploader";
import InputField from "@/components/shared/InputField";
import MetricCard from "@/components/shared/MetricCard";
import { parseCarrierInvoice, parseWarehouseCost, CarrierInvoiceRow, WarehouseCostRow } from "@/lib/csvParsers";
import { warehouseBenchmarks, carrierBenchmarks, scoreBenchmark, BenchmarkCategory, CarrierBenchmark } from "@/lib/benchmarks";
import { formatCurrency, formatNumber } from "@/lib/calculations";
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

export default function AuditPage() {
  // CSV data
  const [carrierData, setCarrierData] = useState<CarrierInvoiceRow[]>([]);
  const [, setWarehouseData] = useState<WarehouseCostRow[]>([]);

  // Manual inputs
  const [monthlyOrders, setMonthlyOrders] = useState(5000);
  const [avgWeight, setAvgWeight] = useState(1.5);

  // Editable benchmarks
  const [whBenchmarks] = useState<BenchmarkCategory[]>(warehouseBenchmarks);
  const [crBenchmarks, setCrBenchmarks] = useState<CarrierBenchmark[]>(carrierBenchmarks);

  // Client warehouse metrics (manual entry)
  const [clientMetrics, setClientMetrics] = useState<Record<string, number>>({
    receiving: 30,
    putaway: 25,
    pick_pack: 20,
    cost_per_order: 6.0,
    accuracy: 99.2,
  });

  const handleCarrierUpload = (csvText: string) => {
    const result = parseCarrierInvoice(csvText);
    setCarrierData(result.rows);
  };

  const handleWarehouseUpload = (csvText: string) => {
    const result = parseWarehouseCost(csvText);
    setWarehouseData(result.rows);
  };

  // Warehouse scorecard
  const warehouseScorecard = useMemo(() => {
    return whBenchmarks.map((bm) => {
      const clientValue = clientMetrics[bm.id] || 0;
      const isLowerBetter = bm.id === "cost_per_order";
      const score = scoreBenchmark(clientValue, bm, isLowerBetter);
      const gapLow = clientValue - bm.low;
      const gapHigh = clientValue - bm.high;
      return {
        ...bm,
        clientValue,
        score,
        gapLow,
        gapHigh,
      };
    });
  }, [whBenchmarks, clientMetrics]);

  // Carrier comparison
  const carrierComparison = useMemo(() => {
    if (carrierData.length === 0) return [];
    return carrierData.map((cr) => {
      const benchmark = crBenchmarks.find(
        (b) =>
          b.carrier.toLowerCase().includes(cr.carrier.toLowerCase()) &&
          b.service.toLowerCase().includes(cr.service.toLowerCase())
      );
      const benchmarkCost = benchmark?.benchmarkCost || 0;
      const gap = cr.avgCost - benchmarkCost;
      const annualSavings = gap > 0 ? gap * cr.shipments * 12 : 0;
      return {
        carrier: cr.carrier,
        service: cr.service,
        clientCost: cr.avgCost,
        benchmarkCost,
        gap,
        shipments: cr.shipments,
        annualSavings,
      };
    });
  }, [carrierData, crBenchmarks]);

  // Total savings opportunity
  const totalCarrierSavings = useMemo(
    () => carrierComparison.reduce((s, c) => s + c.annualSavings, 0),
    [carrierComparison]
  );

  const totalWarehouseSavings = useMemo(() => {
    const costBm = whBenchmarks.find((b) => b.id === "cost_per_order");
    if (!costBm) return 0;
    const clientCost = clientMetrics.cost_per_order || 0;
    const targetCost = (costBm.low + costBm.high) / 2;
    const gap = clientCost - targetCost;
    return gap > 0 ? gap * monthlyOrders * 12 : 0;
  }, [whBenchmarks, clientMetrics, monthlyOrders]);

  const totalSavings = totalCarrierSavings + totalWarehouseSavings;

  // Chart data for carrier comparison
  const carrierChartData = useMemo(
    () =>
      carrierComparison.map((c) => ({
        name: `${c.carrier} ${c.service}`,
        "Client Rate": c.clientCost,
        "TAC Benchmark": c.benchmarkCost,
      })),
    [carrierComparison]
  );

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
        <h1 className="text-3xl font-bold mb-2">Cost Audit & Comparison</h1>
        <p className="text-tac-muted mb-8">
          Benchmark carrier and warehouse costs against TAC standards. Surface savings opportunities.
        </p>

        {/* Hero Savings */}
        {totalSavings > 0 && (
          <div className="card border-tac-accent/50 bg-tac-accent/5 mb-8 text-center py-8">
            <p className="text-tac-muted text-sm mb-1">Total Savings Opportunity</p>
            <p className="text-5xl font-bold text-tac-accent">
              {formatCurrency(totalSavings, 0)}
            </p>
            <p className="text-tac-muted text-sm mt-2">per year</p>
            <p className="text-lg text-tac-text mt-4 font-medium">
              TAC can help you save {formatCurrency(totalSavings, 0)} per year
            </p>
          </div>
        )}

        {/* CSV Uploads */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <CsvUploader
            label="Upload Carrier Invoice CSV"
            description="Columns: Carrier, Service, Shipments, Avg Cost, Zone"
            onUpload={handleCarrierUpload}
          />
          <CsvUploader
            label="Upload Warehouse Cost CSV"
            description="Columns: Category, Monthly Cost, Per Unit Cost"
            onUpload={handleWarehouseUpload}
          />
        </div>

        {/* Manual Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="card">
            <h3 className="text-lg font-semibold mb-4 text-tac-accent">Volume</h3>
            <div className="space-y-3">
              <InputField
                label="Monthly Order Volume"
                value={monthlyOrders}
                onChange={setMonthlyOrders}
                step={100}
                min={0}
              />
              <InputField
                label="Avg Weight per Shipment (kg)"
                value={avgWeight}
                onChange={setAvgWeight}
                suffix="kg"
                step={0.1}
                min={0}
              />
            </div>
          </div>

          <div className="card col-span-1 md:col-span-2">
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
        </div>

        {/* Warehouse Efficiency Scorecard */}
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

        {/* Carrier Comparison */}
        {carrierComparison.length > 0 && (
          <>
            <div className="card mb-8">
              <h3 className="text-lg font-semibold mb-4 text-tac-accent">
                Carrier Rate Comparison
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-tac-border text-tac-muted">
                    <th className="text-left py-2 pr-4">Carrier</th>
                    <th className="text-left py-2 px-3">Service</th>
                    <th className="text-right py-2 px-3">Client Rate</th>
                    <th className="text-right py-2 px-3">TAC Benchmark</th>
                    <th className="text-right py-2 px-3">Gap</th>
                    <th className="text-right py-2 px-3">Monthly Shipments</th>
                    <th className="text-right py-2 px-3">Annual Savings</th>
                  </tr>
                </thead>
                <tbody>
                  {carrierComparison.map((row, i) => (
                    <tr key={i} className="border-b border-tac-border/50">
                      <td className="py-2 pr-4 font-medium">{row.carrier}</td>
                      <td className="py-2 px-3">{row.service}</td>
                      <td className="text-right px-3">{formatCurrency(row.clientCost)}</td>
                      <td className="text-right px-3 text-tac-muted">
                        {row.benchmarkCost > 0
                          ? formatCurrency(row.benchmarkCost)
                          : "—"}
                      </td>
                      <td className={`text-right px-3 ${row.gap > 0 ? "text-tac-danger" : "text-tac-success"}`}>
                        {row.benchmarkCost > 0
                          ? `${row.gap > 0 ? "+" : ""}${formatCurrency(row.gap)}`
                          : "—"}
                      </td>
                      <td className="text-right px-3">{formatNumber(row.shipments)}</td>
                      <td className="text-right px-3 font-semibold text-tac-accent">
                        {row.annualSavings > 0
                          ? formatCurrency(row.annualSavings, 0)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Carrier Chart */}
            <div className="card mb-8">
              <h3 className="text-lg font-semibold mb-4">
                Cost per Shipment: Client vs Benchmark
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={carrierChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2D4050" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#A0AEB8" }} />
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
                  <Bar dataKey="Client Rate" fill="#F87171" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="TAC Benchmark" fill="#F5B36B" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}

        {/* Editable Benchmarks */}
        <div className="card mb-8">
          <h3 className="text-lg font-semibold mb-4 text-tac-accent">
            TAC Carrier Benchmarks
            <span className="text-xs font-normal text-tac-muted ml-2">(editable)</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {crBenchmarks.map((bm, i) => (
              <div key={bm.id} className="flex items-center gap-2">
                <span className="text-xs text-tac-muted whitespace-nowrap min-w-[120px]">
                  {bm.carrier} {bm.service}
                </span>
                <span className="text-tac-muted text-xs">$</span>
                <input
                  type="number"
                  value={bm.benchmarkCost}
                  onChange={(e) => {
                    const updated = [...crBenchmarks];
                    updated[i] = { ...updated[i], benchmarkCost: parseFloat(e.target.value) || 0 };
                    setCrBenchmarks(updated);
                  }}
                  step={0.5}
                  className="input-field text-xs py-1 w-20"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Summary Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard
            label="Carrier Savings (Annual)"
            value={formatCurrency(totalCarrierSavings, 0)}
            accent={totalCarrierSavings > 0}
          />
          <MetricCard
            label="Warehouse Savings (Annual)"
            value={formatCurrency(totalWarehouseSavings, 0)}
            accent={totalWarehouseSavings > 0}
          />
          <MetricCard
            label="Total Opportunity"
            value={formatCurrency(totalSavings, 0)}
            accent
          />
        </div>
      </main>
    </>
  );
}
