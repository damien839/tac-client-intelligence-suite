"use client";

import { useState, useMemo, useEffect } from "react";
import Nav from "@/components/shared/Nav";
import InputField from "@/components/shared/InputField";
import MetricCard from "@/components/shared/MetricCard";
import {
  RetentionInputs,
  computeRetention,
  formatCurrency,
  formatPercent,

} from "@/lib/calculations";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

export default function RetentionPage() {
  const [inputs, setInputs] = useState<RetentionInputs>({
    monthlyOrderVolume: 5000,
    percentNewCustomers: 0.65,
    percentRepeatCustomers: 0.35,
    aovNew: 120,
    aovRepeat: 150,
    cacNew: 45,
    grossMarginPercent: 0.74,
    fixedCostsPerMonth: 50000,
    proposedRepeatRateImprovement: 0.05,
    tacMonthlyFee: 10000,
  });

  const update = (key: keyof RetentionInputs, value: number) => {
    setInputs((prev) => {
      const updated = { ...prev, [key]: value };
      // Auto-balance new/repeat split
      if (key === "percentNewCustomers") {
        updated.percentRepeatCustomers = 1 - value;
      } else if (key === "percentRepeatCustomers") {
        updated.percentNewCustomers = 1 - value;
      }
      return updated;
    });
  };

  const result = useMemo(() => computeRetention(inputs), [inputs]);

  // Auto-save results to localStorage for the Report page
  useEffect(() => {
    const profile = JSON.parse(localStorage.getItem("tac-client-profile") || "{}");
    localStorage.setItem(
      "tac_retention_results",
      JSON.stringify({
        timestamp: new Date().toISOString(),
        clientName: profile.clientName || "",
        currentEbit: result.currentEbit,
        proposedEbit: result.proposedEbit,
        ebitUplift: result.ebitUplift,
        ebitUpliftPercent: result.ebitUpliftPercent,
        annualEbitUplift: result.ebitUplift * 12,
        breakEvenMonths: result.breakEvenMonths,
        tacMonthlyFee: inputs.tacMonthlyFee,
        currentBlendedCac: result.currentBlendedCac,
        proposedBlendedCac: result.proposedBlendedCac,
      })
    );
  }, [result, inputs.tacMonthlyFee]);

  const chartData = result.monthlyProjection.map((m) => ({
    month: `M${m.month}`,
    "Current EBIT": Math.round(m.currentEbit),
    "Proposed EBIT": Math.round(m.proposedEbit),
    "Cumulative Uplift": Math.round(m.cumulativeUplift),
  }));

  return (
    <>
      <Nav />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-2">EBIT & Retention Model</h1>
        <p className="text-tac-muted mb-8">
          Quantify the EBIT uplift from improving repeat purchase rates. More
          repeat customers = lower blended CAC = higher margins.
        </p>

        {/* Inputs */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Volume & Mix */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4 text-tac-accent">
              Order Volume & Mix
            </h3>
            <div className="space-y-3">
              <InputField
                label="Monthly Order Volume"
                value={inputs.monthlyOrderVolume}
                onChange={(v) => update("monthlyOrderVolume", v)}
                step={100}
                min={0}
              />
              <InputField
                label="% New Customers"
                value={inputs.percentNewCustomers * 100}
                onChange={(v) => update("percentNewCustomers", v / 100)}
                suffix="%"
                step={1}
                min={0}
                max={100}
              />
              <InputField
                label="% Repeat Customers"
                value={inputs.percentRepeatCustomers * 100}
                onChange={(v) => update("percentRepeatCustomers", v / 100)}
                suffix="%"
                step={1}
                min={0}
                max={100}
              />
              <InputField
                label="AOV — New Customers"
                value={inputs.aovNew}
                onChange={(v) => update("aovNew", v)}
                prefix="$"
                step={5}
                min={0}
              />
              <InputField
                label="AOV — Repeat Customers"
                value={inputs.aovRepeat}
                onChange={(v) => update("aovRepeat", v)}
                prefix="$"
                step={5}
                min={0}
              />
            </div>
          </div>

          {/* Cost Structure */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4 text-tac-accent">
              Cost Structure
            </h3>
            <div className="space-y-3">
              <InputField
                label="CAC — New Customers"
                value={inputs.cacNew}
                onChange={(v) => update("cacNew", v)}
                prefix="$"
                step={1}
                min={0}
                tooltip="Customer Acquisition Cost for new customers"
              />
              <InputField
                label="Gross Margin %"
                value={inputs.grossMarginPercent * 100}
                onChange={(v) => update("grossMarginPercent", v / 100)}
                suffix="%"
                step={1}
                min={0}
                max={100}
                tooltip="Revenue minus COGS, as a percentage"
              />
              <InputField
                label="Fixed Costs per Month"
                value={inputs.fixedCostsPerMonth}
                onChange={(v) => update("fixedCostsPerMonth", v)}
                prefix="$"
                step={1000}
                min={0}
              />
            </div>
          </div>

          {/* Improvement Scenario */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4 text-tac-accent">
              Improvement Scenario
            </h3>
            <div className="space-y-3">
              <div>
                <label className="label-text">
                  Proposed Repeat Rate Improvement:{" "}
                  {(inputs.proposedRepeatRateImprovement * 100).toFixed(0)}%
                </label>
                <input
                  type="range"
                  min={1}
                  max={30}
                  step={1}
                  value={inputs.proposedRepeatRateImprovement * 100}
                  onChange={(e) =>
                    update(
                      "proposedRepeatRateImprovement",
                      parseInt(e.target.value) / 100
                    )
                  }
                  className="w-full accent-tac-accent"
                />
                <div className="flex justify-between text-xs text-tac-muted">
                  <span>+1%</span>
                  <span>+15%</span>
                  <span>+30%</span>
                </div>
              </div>
              <p className="text-sm text-tac-muted">
                New repeat rate:{" "}
                <span className="text-tac-accent font-semibold">
                  {formatPercent(
                    inputs.percentRepeatCustomers +
                      inputs.proposedRepeatRateImprovement
                  )}
                </span>{" "}
                (currently {formatPercent(inputs.percentRepeatCustomers)})
              </p>
              <hr className="border-tac-border" />
              <InputField
                label="TAC Monthly Fee (optional)"
                value={inputs.tacMonthlyFee}
                onChange={(v) => update("tacMonthlyFee", v)}
                prefix="$"
                step={500}
                min={0}
                tooltip="Enter TAC engagement fee to calculate break-even period"
              />
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <MetricCard
            label="Current Monthly EBIT"
            value={formatCurrency(result.currentEbit, 0)}
          />
          <MetricCard
            label="Proposed Monthly EBIT"
            value={formatCurrency(result.proposedEbit, 0)}
            accent
          />
          <MetricCard
            label="Monthly EBIT Uplift"
            value={formatCurrency(result.ebitUplift, 0)}
            trend={result.ebitUplift > 0 ? "up" : result.ebitUplift < 0 ? "down" : "neutral"}
            trendValue={`${result.ebitUpliftPercent.toFixed(1)}%`}
          />
          {result.breakEvenMonths !== null && (
            <MetricCard
              label="Break-Even on TAC Fee"
              value={`${result.breakEvenMonths} month${result.breakEvenMonths !== 1 ? "s" : ""}`}
              subtitle={`TAC fee: ${formatCurrency(inputs.tacMonthlyFee, 0)}/mo`}
              accent
            />
          )}
        </div>

        {/* Blended CAC Comparison */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Blended CAC</h3>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-tac-muted">Current</p>
                <p className="text-2xl font-bold">
                  {formatCurrency(result.currentBlendedCac)}
                </p>
              </div>
              <div>
                <p className="text-sm text-tac-muted">Proposed</p>
                <p className="text-2xl font-bold text-tac-accent">
                  {formatCurrency(result.proposedBlendedCac)}
                </p>
              </div>
              <div>
                <p className="text-sm text-tac-muted">Savings per Order</p>
                <p className="text-lg font-semibold text-tac-success">
                  {formatCurrency(
                    result.currentBlendedCac - result.proposedBlendedCac
                  )}
                </p>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Annual Impact</h3>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-tac-muted">Annual EBIT Uplift</p>
                <p className="text-2xl font-bold text-tac-accent">
                  {formatCurrency(result.ebitUplift * 12, 0)}
                </p>
              </div>
              <div>
                <p className="text-sm text-tac-muted">Annual TAC Investment</p>
                <p className="text-2xl font-bold">
                  {formatCurrency(inputs.tacMonthlyFee * 12, 0)}
                </p>
              </div>
              <div>
                <p className="text-sm text-tac-muted">Net ROI</p>
                <p className="text-lg font-semibold text-tac-success">
                  {inputs.tacMonthlyFee > 0
                    ? `${(
                        ((result.ebitUplift * 12 - inputs.tacMonthlyFee * 12) /
                          (inputs.tacMonthlyFee * 12)) *
                        100
                      ).toFixed(0)}%`
                    : "—"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 12-Month Projection Chart */}
        <div className="card mb-8">
          <h3 className="text-lg font-semibold mb-4">
            12-Month Cumulative EBIT Projection
          </h3>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2D4050" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#A0AEB8" }} />
              <YAxis
                tick={{ fontSize: 11, fill: "#A0AEB8" }}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1F3040",
                  border: "1px solid #2D4050",
                  borderRadius: 8,
                  color: "#fff",
                }}
                formatter={(value) => formatCurrency(Number(value), 0)}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="Current EBIT"
                stroke="#A0AEB8"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="Proposed EBIT"
                stroke="#F5B36B"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="Cumulative Uplift"
                stroke="#4ADE80"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </main>
    </>
  );
}
