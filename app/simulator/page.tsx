"use client";

import { useState, useMemo, useCallback } from "react";
import Nav from "@/components/shared/Nav";
import CsvUploader from "@/components/shared/CsvUploader";
import InputField from "@/components/shared/InputField";
import MetricCard from "@/components/shared/MetricCard";
import { parseShopifyOrders } from "@/lib/csvParsers";
import {
  OrderRow,
  UnitEconomics,
  ElasticityInputs,
  bucketOrders,
  computeScenarioDeterministic,
  findOptimalThreshold,
  formatCurrency,
  formatPercent,
  formatNumber,
  grossMarginFromCogs,
} from "@/lib/calculations";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const CHART_COLORS = ["#F5B36B", "#A0AEB8", "#4ADE80", "#F87171", "#60A5FA", "#C084FC"];

export default function SimulatorPage() {
  // Order data
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);

  // Unit economics — all editable, nothing hardcoded
  const [economics, setEconomics] = useState<UnitEconomics>({
    cogsPercent: 0.26,
    shippingCostPerOrder: 12,
    txFeePercent: 0.035,
    txFeeFixed: 0.3,
    shippingChargeToCustomer: 9.95,
    returnRate: 0,
    returnShippingCost: 0,
  });

  // Threshold config
  const [currentThreshold, setCurrentThreshold] = useState(150);
  const [proposedThreshold, setProposedThreshold] = useState(200);
  const [flatFee, setFlatFee] = useState(0);

  // Elasticity
  const [elasticity, setElasticity] = useState<ElasticityInputs>({
    enabled: false,
    cartAbandonmentRate: 0.1,
    thresholdSeekingUplift: 0.15,
    seekerAovUplift: 50,
  });

  const handleCsvUpload = useCallback((csvText: string) => {
    const result = parseShopifyOrders(csvText);
    setOrders(result.orders);
    setParseErrors(result.errors);
    setParseWarnings(result.warnings);
  }, []);

  // Computed data
  const buckets = useMemo(() => bucketOrders(orders), [orders]);

  const currentScenario = useMemo(
    () =>
      orders.length > 0
        ? computeScenarioDeterministic(orders, currentThreshold, economics, elasticity, flatFee)
        : null,
    [orders, currentThreshold, economics, elasticity, flatFee]
  );

  const proposedScenario = useMemo(
    () =>
      orders.length > 0
        ? computeScenarioDeterministic(orders, proposedThreshold, economics, elasticity, flatFee)
        : null,
    [orders, proposedThreshold, economics, elasticity, flatFee]
  );

  const removeScenario = useMemo(
    () =>
      orders.length > 0
        ? computeScenarioDeterministic(orders, 0, economics, elasticity, flatFee)
        : null,
    [orders, economics, elasticity, flatFee]
  );

  const optimal = useMemo(
    () =>
      orders.length > 0
        ? findOptimalThreshold(orders, economics, elasticity, flatFee)
        : null,
    [orders, economics, elasticity, flatFee]
  );

  // Chart data
  const aovChartData = useMemo(
    () =>
      buckets.map((b) => ({
        range: b.rangeLabel,
        orders: b.orderCount,
        avgAov: Math.round(b.avgAov),
      })),
    [buckets]
  );

  const profitByBucket = useMemo(() => {
    if (!orders.length) return [];
    return buckets.map((b) => {
      const avgShippingCollected =
        b.avgAov >= currentThreshold ? 0 : economics.shippingChargeToCustomer;
      const grossProfit = b.avgAov * grossMarginFromCogs(economics.cogsPercent);
      const txFees = b.avgAov * economics.txFeePercent + economics.txFeeFixed;
      const profit =
        grossProfit +
        avgShippingCollected -
        economics.shippingCostPerOrder -
        txFees;
      return {
        range: b.rangeLabel,
        profitPerOrder: Math.round(profit * 100) / 100,
        orders: b.orderCount,
      };
    });
  }, [buckets, currentThreshold, economics]);

  // Carrier split data
  const carrierSplitData = useMemo(() => {
    if (!orders.length) return [];
    const splitMap: Record<string, number> = {};
    for (const order of orders) {
      const svc = order.carrierService || "Unknown";
      splitMap[svc] = (splitMap[svc] || 0) + 1;
    }
    return Object.entries(splitMap).map(([name, value]) => ({ name, value }));
  }, [orders]);

  // Free shipping zone %
  const freeShippingPct = useMemo(() => {
    if (!orders.length) return 0;
    const aboveThreshold = orders.filter(
      (o) => o.totalPrice >= currentThreshold
    ).length;
    return aboveThreshold / orders.length;
  }, [orders, currentThreshold]);

  // Scenario comparison table
  const scenarioComparison = useMemo(() => {
    if (!currentScenario || !proposedScenario || !removeScenario) return [];
    return [
      {
        ...currentScenario,
        label: `Current ($${currentThreshold})`,
        delta: 0,
        deltaPct: 0,
      },
      {
        ...proposedScenario,
        label: `Proposed ($${proposedThreshold})`,
        delta: proposedScenario.totalProfit - currentScenario.totalProfit,
        deltaPct:
          currentScenario.totalProfit !== 0
            ? ((proposedScenario.totalProfit - currentScenario.totalProfit) /
                Math.abs(currentScenario.totalProfit)) *
              100
            : 0,
      },
      {
        ...removeScenario,
        label: "No Threshold",
        delta: removeScenario.totalProfit - currentScenario.totalProfit,
        deltaPct:
          currentScenario.totalProfit !== 0
            ? ((removeScenario.totalProfit - currentScenario.totalProfit) /
                Math.abs(currentScenario.totalProfit)) *
              100
            : 0,
      },
    ];
  }, [
    currentScenario,
    proposedScenario,
    removeScenario,
    currentThreshold,
    proposedThreshold,
  ]);

  const updateEconomics = (key: keyof UnitEconomics, value: number) => {
    setEconomics((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <>
      <Nav />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-2">
          Shipping Strategy Simulator
        </h1>
        <p className="text-tac-muted mb-8">
          Model how different free shipping thresholds affect profit, carrier
          mix, and shipping cost recovery.
        </p>

        {/* CSV Upload */}
        <div className="mb-8">
          <CsvUploader
            label="Upload Shopify Orders CSV"
            description="Required: Total Price, Shipping. Optional: Carrier/Service Level, Line Item Quantity"
            onUpload={handleCsvUpload}
          />
          {parseErrors.length > 0 && (
            <div className="mt-3 p-3 bg-tac-danger/10 border border-tac-danger/30 rounded-lg">
              {parseErrors.map((e, i) => (
                <p key={i} className="text-sm text-tac-danger">
                  {e}
                </p>
              ))}
            </div>
          )}
          {parseWarnings.length > 0 && (
            <div className="mt-3 p-3 bg-tac-warning/10 border border-tac-warning/30 rounded-lg">
              {parseWarnings.map((w, i) => (
                <p key={i} className="text-sm text-tac-warning">
                  {w}
                </p>
              ))}
            </div>
          )}
          {orders.length > 0 && (
            <p className="mt-2 text-sm text-tac-success">
              ✓ {formatNumber(orders.length)} orders loaded
            </p>
          )}
        </div>

        {/* Inputs Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Unit Economics */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4 text-tac-accent">
              Unit Economics
            </h3>
            <div className="space-y-3">
              <InputField
                label="COGS %"
                value={economics.cogsPercent * 100}
                onChange={(v) => updateEconomics("cogsPercent", v / 100)}
                suffix="%"
                step={1}
                min={0}
                max={100}
                tooltip="Cost of goods sold as % of revenue. Gross margin = 100% - COGS%"
              />
              <p className="text-xs text-tac-muted">
                Derived gross margin:{" "}
                {formatPercent(grossMarginFromCogs(economics.cogsPercent))}
              </p>
              <InputField
                label="Shipping & Fulfilment Cost"
                value={economics.shippingCostPerOrder}
                onChange={(v) => updateEconomics("shippingCostPerOrder", v)}
                prefix="$"
                step={0.5}
                min={0}
              />
              <InputField
                label="Transaction Fee (Variable)"
                value={economics.txFeePercent * 100}
                onChange={(v) => updateEconomics("txFeePercent", v / 100)}
                suffix="%"
                step={0.1}
                min={0}
              />
              <InputField
                label="Transaction Fee (Fixed)"
                value={economics.txFeeFixed}
                onChange={(v) => updateEconomics("txFeeFixed", v)}
                prefix="$"
                step={0.05}
                min={0}
              />
              <InputField
                label="Shipping Charge to Customer"
                value={economics.shippingChargeToCustomer}
                onChange={(v) =>
                  updateEconomics("shippingChargeToCustomer", v)
                }
                prefix="$"
                step={0.5}
                min={0}
                tooltip="What the customer pays for shipping when below the free shipping threshold"
              />
            </div>
          </div>

          {/* Returns & Threshold */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4 text-tac-accent">
              Threshold & Returns
            </h3>
            <div className="space-y-3">
              <InputField
                label="Current Free Shipping Threshold"
                value={currentThreshold}
                onChange={setCurrentThreshold}
                prefix="$"
                step={5}
                min={0}
              />
              <div>
                <label className="label-text">
                  Proposed Threshold: ${proposedThreshold}
                </label>
                <input
                  type="range"
                  min={0}
                  max={500}
                  step={5}
                  value={proposedThreshold}
                  onChange={(e) =>
                    setProposedThreshold(parseInt(e.target.value))
                  }
                  className="w-full accent-tac-accent"
                />
                <div className="flex justify-between text-xs text-tac-muted">
                  <span>$0</span>
                  <span>$250</span>
                  <span>$500</span>
                </div>
              </div>
              <InputField
                label="Flat Fee Alternative (0 = disabled)"
                value={flatFee}
                onChange={setFlatFee}
                prefix="$"
                step={0.5}
                min={0}
                tooltip="Charge this flat fee for sub-threshold orders instead of the full shipping rate"
              />
              <hr className="border-tac-border" />
              <InputField
                label="Return Rate"
                value={economics.returnRate * 100}
                onChange={(v) => updateEconomics("returnRate", v / 100)}
                suffix="%"
                step={1}
                min={0}
                max={100}
              />
              <InputField
                label="Return Shipping Cost"
                value={economics.returnShippingCost}
                onChange={(v) => updateEconomics("returnShippingCost", v)}
                prefix="$"
                step={0.5}
                min={0}
              />
            </div>
          </div>

          {/* Elasticity */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4 text-tac-accent">
              Demand Elasticity
              <span className="text-xs font-normal text-tac-muted ml-2">
                (optional)
              </span>
            </h3>
            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={elasticity.enabled}
                  onChange={(e) =>
                    setElasticity((prev) => ({
                      ...prev,
                      enabled: e.target.checked,
                    }))
                  }
                  className="accent-tac-accent w-4 h-4"
                />
                <span className="text-sm text-tac-text">
                  Enable elasticity modelling
                </span>
              </label>

              {elasticity.enabled && (
                <>
                  <InputField
                    label="Cart Abandonment Rate"
                    value={elasticity.cartAbandonmentRate * 100}
                    onChange={(v) =>
                      setElasticity((prev) => ({
                        ...prev,
                        cartAbandonmentRate: v / 100,
                      }))
                    }
                    suffix="%"
                    step={1}
                    min={0}
                    max={100}
                    tooltip="% of sub-threshold orders lost when customers see a shipping charge"
                  />
                  <InputField
                    label="Threshold-Seeking Uplift"
                    value={elasticity.thresholdSeekingUplift * 100}
                    onChange={(v) =>
                      setElasticity((prev) => ({
                        ...prev,
                        thresholdSeekingUplift: v / 100,
                      }))
                    }
                    suffix="%"
                    step={1}
                    min={0}
                    max={100}
                    tooltip="% of near-threshold orders that add items to qualify for free shipping"
                  />
                  <InputField
                    label="Seeker AOV Uplift Range"
                    value={elasticity.seekerAovUplift}
                    onChange={(v) =>
                      setElasticity((prev) => ({
                        ...prev,
                        seekerAovUplift: v,
                      }))
                    }
                    prefix="$"
                    step={5}
                    min={0}
                    tooltip="Orders within this $ range below threshold may add items to qualify"
                  />
                </>
              )}
            </div>
          </div>
        </div>

        {/* Results */}
        {orders.length > 0 && currentScenario && proposedScenario && (
          <>
            {/* Key Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <MetricCard
                label="Total Orders"
                value={formatNumber(orders.length)}
              />
              <MetricCard
                label="Mean AOV"
                value={formatCurrency(
                  orders.reduce((s, o) => s + o.totalPrice, 0) / orders.length
                )}
              />
              <MetricCard
                label="Free Shipping Zone"
                value={formatPercent(freeShippingPct)}
                subtitle={`${formatNumber(
                  Math.round(orders.length * freeShippingPct)
                )} orders above $${currentThreshold}`}
              />
              {optimal && (
                <MetricCard
                  label="Optimal Threshold"
                  value={`$${optimal.threshold}`}
                  subtitle={`Max profit: ${formatCurrency(optimal.profit)}`}
                  accent
                />
              )}
            </div>

            {/* Scenario Comparison Table */}
            <div className="card mb-8 overflow-x-auto">
              <h3 className="text-lg font-semibold mb-4 text-tac-accent">
                Scenario Comparison
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-tac-border text-tac-muted">
                    <th className="text-left py-2 pr-4">Scenario</th>
                    <th className="text-right py-2 px-3">Orders</th>
                    <th className="text-right py-2 px-3">Paying Shipping</th>
                    <th className="text-right py-2 px-3">Shipping Rev</th>
                    <th className="text-right py-2 px-3">Total Profit</th>
                    <th className="text-right py-2 px-3">Profit/Order</th>
                    <th className="text-right py-2 px-3">Δ Profit</th>
                    <th className="text-right py-2 px-3">Δ %</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarioComparison.map((s, i) => (
                    <tr
                      key={i}
                      className="border-b border-tac-border/50 hover:bg-tac-bg-light/50"
                    >
                      <td className="py-2 pr-4 font-medium">{s.label}</td>
                      <td className="text-right px-3">
                        {formatNumber(s.totalOrders)}
                      </td>
                      <td className="text-right px-3">
                        {formatNumber(s.ordersPayingShipping)}
                      </td>
                      <td className="text-right px-3">
                        {formatCurrency(s.totalShippingCollected)}
                      </td>
                      <td className="text-right px-3 font-semibold">
                        {formatCurrency(s.totalProfit)}
                      </td>
                      <td className="text-right px-3">
                        {formatCurrency(s.avgProfitPerOrder)}
                      </td>
                      <td
                        className={`text-right px-3 ${
                          s.delta > 0
                            ? "text-tac-success"
                            : s.delta < 0
                            ? "text-tac-danger"
                            : "text-tac-muted"
                        }`}
                      >
                        {i === 0
                          ? "—"
                          : `${s.delta >= 0 ? "+" : ""}${formatCurrency(
                              s.delta
                            )}`}
                      </td>
                      <td
                        className={`text-right px-3 ${
                          s.deltaPct > 0
                            ? "text-tac-success"
                            : s.deltaPct < 0
                            ? "text-tac-danger"
                            : "text-tac-muted"
                        }`}
                      >
                        {i === 0
                          ? "—"
                          : `${s.deltaPct >= 0 ? "+" : ""}${s.deltaPct.toFixed(
                              2
                            )}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {/* AOV Distribution */}
              <div className="card">
                <h3 className="text-lg font-semibold mb-4">
                  AOV Distribution
                </h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={aovChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2D4050" />
                    <XAxis
                      dataKey="range"
                      tick={{ fontSize: 10, fill: "#A0AEB8" }}
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fontSize: 11, fill: "#A0AEB8" }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1F3040",
                        border: "1px solid #2D4050",
                        borderRadius: 8,
                        color: "#fff",
                      }}
                    />
                    <Bar dataKey="orders" fill="#F5B36B" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Profit by AOV Bucket */}
              <div className="card">
                <h3 className="text-lg font-semibold mb-4">
                  Profit per Order by AOV
                </h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={profitByBucket}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2D4050" />
                    <XAxis
                      dataKey="range"
                      tick={{ fontSize: 10, fill: "#A0AEB8" }}
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fontSize: 11, fill: "#A0AEB8" }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1F3040",
                        border: "1px solid #2D4050",
                        borderRadius: 8,
                        color: "#fff",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="profitPerOrder"
                      stroke="#F5B36B"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Carrier Split */}
              {carrierSplitData.length > 0 && carrierSplitData[0].name !== "Unknown" && (
                <div className="card">
                  <h3 className="text-lg font-semibold mb-4">
                    Carrier Service Split
                  </h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={carrierSplitData}
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        dataKey="value"
                        nameKey="name"
                        label={({ name, percent }) =>
                          `${name} (${((percent || 0) * 100).toFixed(0)}%)`
                        }
                      >
                        {carrierSplitData.map((_, i) => (
                          <Cell
                            key={i}
                            fill={CHART_COLORS[i % CHART_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#1F3040",
                          border: "1px solid #2D4050",
                          borderRadius: 8,
                          color: "#fff",
                        }}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </>
        )}

        {orders.length === 0 && (
          <div className="text-center py-16 text-tac-muted">
            <p className="text-lg">Upload a Shopify orders CSV to begin analysis</p>
            <p className="text-sm mt-2">
              Required columns: Total Price, Shipping. Optional: Carrier/Service Level
            </p>
          </div>
        )}
      </main>
    </>
  );
}
