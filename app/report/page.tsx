"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Nav from "@/components/shared/Nav";
import { formatCurrency } from "@/lib/calculations";

interface ClientProfile {
  clientName: string;
  industry: string;
  auditDate: string;
  currency: string;
}

interface SimulatorResults {
  timestamp: string;
  clientName: string;
  optimalThreshold: number;
  optimalProfit: number;
  currentThreshold: number;
  proposedThreshold: number;
  currentProfit: number;
  proposedProfit: number;
  profitDelta: number;
  carrierSplitSummary: string;
  totalOrders: number;
  avgProfitPerOrder: number;
}

interface AuditResults {
  timestamp: string;
  clientName: string;
  totalSavingsOpportunity: number;
  carrierSavings: number;
  warehouseSavings: number;
  topBenchmarkGaps: string[];
  monthlyOrders: number;
}

interface RetentionResults {
  timestamp: string;
  clientName: string;
  currentEbit: number;
  proposedEbit: number;
  ebitUplift: number;
  ebitUpliftPercent: number;
  annualEbitUplift: number;
  breakEvenMonths: number | null;
  tacMonthlyFee: number;
  currentBlendedCac: number;
  proposedBlendedCac: number;
}

function timeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} min${diffMins !== 1 ? "s" : ""} ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
}

function PlaceholderCard({ title, href, icon }: { title: string; href: string; icon: string }) {
  return (
    <div className="card border-dashed border-tac-border/60 bg-tac-bg-card/50">
      <div className="text-center py-6">
        <p className="text-3xl mb-3">{icon}</p>
        <p className="text-tac-muted mb-3">Module not yet run</p>
        <Link href={href} className="btn-secondary text-sm inline-block">
          Run {title} →
        </Link>
      </div>
    </div>
  );
}

function UpdatedBadge({ timestamp }: { timestamp: string }) {
  return (
    <span className="text-xs text-tac-muted font-normal ml-2">
      Last updated: {timeAgo(timestamp)}
    </span>
  );
}

export default function ReportPage() {
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [simulator, setSimulator] = useState<SimulatorResults | null>(null);
  const [audit, setAudit] = useState<AuditResults | null>(null);
  const [retention, setRetention] = useState<RetentionResults | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const loadData = () => {
      const p = localStorage.getItem("tac-client-profile");
      if (p) setProfile(JSON.parse(p));

      const s = localStorage.getItem("tac_simulator_results");
      if (s) setSimulator(JSON.parse(s));

      const a = localStorage.getItem("tac_audit_results");
      if (a) setAudit(JSON.parse(a));

      const r = localStorage.getItem("tac_retention_results");
      if (r) setRetention(JSON.parse(r));
    };

    loadData();

    // Refresh timestamps every 30 seconds
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  const handlePrint = () => {
    window.print();
  };

  const reportDate = new Date().toLocaleDateString("en-AU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <div className="no-print">
        <Nav />
      </div>
      <main className="max-w-4xl mx-auto px-4 py-8 report-content">
        {/* Print Header */}
        <div className="text-center mb-10">
          <p className="text-tac-accent tracking-[0.3em] text-sm font-light uppercase mb-4">
            The Aggregate Co.
          </p>
          <h1 className="text-4xl font-bold mb-2">Client Intelligence Report</h1>
          {profile && (
            <div className="text-tac-muted mt-4 space-y-1">
              {profile.clientName && (
                <p className="text-lg font-medium text-tac-text">
                  {profile.clientName}
                </p>
              )}
              <p>
                {profile.industry && `${profile.industry} · `}
                {reportDate}
              </p>
            </div>
          )}
          {!profile?.clientName && (
            <p className="text-tac-muted mt-4">
              <Link href="/" className="text-tac-accent underline">
                Set client name on home page
              </Link>
            </p>
          )}
        </div>

        {/* Executive Summary */}
        <section className="card mb-8">
          <h2 className="text-2xl font-semibold text-tac-accent mb-4">
            Executive Summary
          </h2>
          <p className="text-tac-muted leading-relaxed">
            This report presents findings from The Aggregate Co.&apos;s analysis of{" "}
            {profile?.clientName || "the client"}&apos;s ecommerce operations.
            Three areas were evaluated: shipping threshold strategy, carrier and
            warehouse cost benchmarking, and customer retention impact on EBIT.
          </p>
          {(simulator || audit || retention) && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              {simulator && (
                <div className="bg-tac-bg-light rounded-lg p-3 text-center">
                  <p className="text-xs text-tac-muted">Optimal Threshold</p>
                  <p className="text-xl font-bold text-tac-accent">${simulator.optimalThreshold}</p>
                </div>
              )}
              {audit && (
                <div className="bg-tac-bg-light rounded-lg p-3 text-center">
                  <p className="text-xs text-tac-muted">Total Savings Opportunity</p>
                  <p className="text-xl font-bold text-tac-accent">
                    {formatCurrency(audit.totalSavingsOpportunity, 0)}
                  </p>
                </div>
              )}
              {retention && (
                <div className="bg-tac-bg-light rounded-lg p-3 text-center">
                  <p className="text-xs text-tac-muted">Annual EBIT Uplift</p>
                  <p className="text-xl font-bold text-tac-accent">
                    {formatCurrency(retention.annualEbitUplift, 0)}
                  </p>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Module 1: Shipping Strategy */}
        <section className="card mb-8 print-break">
          <h2 className="text-2xl font-semibold text-tac-accent mb-4">
            Module 1: Shipping Strategy
            {simulator && <UpdatedBadge timestamp={simulator.timestamp} />}
          </h2>

          {simulator ? (
            <>
              <p className="text-tac-muted leading-relaxed mb-4">
                Analysis of {simulator.totalOrders.toLocaleString()} orders to determine optimal free shipping threshold and profit impact.
              </p>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                <div className="bg-tac-bg-light rounded-lg p-3">
                  <p className="text-xs text-tac-muted">Optimal Threshold</p>
                  <p className="text-2xl font-bold text-tac-accent">${simulator.optimalThreshold}</p>
                  <p className="text-xs text-tac-muted mt-1">
                    Maximises profit at {formatCurrency(simulator.optimalProfit, 0)}
                  </p>
                </div>
                <div className="bg-tac-bg-light rounded-lg p-3">
                  <p className="text-xs text-tac-muted">Profit Impact (Proposed)</p>
                  <p className={`text-2xl font-bold ${simulator.profitDelta >= 0 ? "text-tac-success" : "text-tac-danger"}`}>
                    {simulator.profitDelta >= 0 ? "+" : ""}{formatCurrency(simulator.profitDelta, 0)}
                  </p>
                  <p className="text-xs text-tac-muted mt-1">
                    vs current ${simulator.currentThreshold} threshold
                  </p>
                </div>
                <div className="bg-tac-bg-light rounded-lg p-3">
                  <p className="text-xs text-tac-muted">Avg Profit per Order</p>
                  <p className="text-2xl font-bold">{formatCurrency(simulator.avgProfitPerOrder)}</p>
                </div>
              </div>

              {simulator.carrierSplitSummary && (
                <div className="mt-3">
                  <p className="text-sm text-tac-muted">
                    <strong className="text-tac-text">Carrier Split:</strong>{" "}
                    {simulator.carrierSplitSummary}
                  </p>
                </div>
              )}
            </>
          ) : (
            <PlaceholderCard title="Shipping Strategy Simulator" href="/simulator" icon="📦" />
          )}
        </section>

        {/* Module 2: Cost Audit */}
        <section className="card mb-8 print-break">
          <h2 className="text-2xl font-semibold text-tac-accent mb-4">
            Module 2: Cost Audit & Benchmarking
            {audit && <UpdatedBadge timestamp={audit.timestamp} />}
          </h2>

          {audit ? (
            <>
              <p className="text-tac-muted leading-relaxed mb-4">
                Benchmarking of carrier rates and warehouse operations against TAC industry standards.
              </p>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                <div className="bg-tac-bg-light rounded-lg p-3">
                  <p className="text-xs text-tac-muted">Total Savings Opportunity</p>
                  <p className="text-2xl font-bold text-tac-accent">
                    {formatCurrency(audit.totalSavingsOpportunity, 0)}
                  </p>
                  <p className="text-xs text-tac-muted mt-1">per year</p>
                </div>
                <div className="bg-tac-bg-light rounded-lg p-3">
                  <p className="text-xs text-tac-muted">Carrier Savings</p>
                  <p className="text-xl font-bold">
                    {formatCurrency(audit.carrierSavings, 0)}
                  </p>
                </div>
                <div className="bg-tac-bg-light rounded-lg p-3">
                  <p className="text-xs text-tac-muted">Warehouse Savings</p>
                  <p className="text-xl font-bold">
                    {formatCurrency(audit.warehouseSavings, 0)}
                  </p>
                </div>
              </div>

              {audit.topBenchmarkGaps.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium text-tac-text mb-2">
                    Top Benchmark Gaps:
                  </p>
                  <ul className="list-disc pl-5 space-y-1 text-sm text-tac-muted">
                    {audit.topBenchmarkGaps.map((gap, i) => (
                      <li key={i}>{gap}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <PlaceholderCard title="Cost Audit" href="/audit" icon="📊" />
          )}
        </section>

        {/* Module 3: Retention */}
        <section className="card mb-8 print-break">
          <h2 className="text-2xl font-semibold text-tac-accent mb-4">
            Module 3: EBIT & Retention Impact
            {retention && <UpdatedBadge timestamp={retention.timestamp} />}
          </h2>

          {retention ? (
            <>
              <p className="text-tac-muted leading-relaxed mb-4">
                Quantified impact of improving repeat purchase rates on EBIT and blended customer acquisition cost.
              </p>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                <div className="bg-tac-bg-light rounded-lg p-3">
                  <p className="text-xs text-tac-muted">Annual EBIT Uplift</p>
                  <p className="text-2xl font-bold text-tac-accent">
                    {formatCurrency(retention.annualEbitUplift, 0)}
                  </p>
                  <p className="text-xs text-tac-muted mt-1">
                    {retention.ebitUpliftPercent > 0 ? "+" : ""}{retention.ebitUpliftPercent.toFixed(1)}% improvement
                  </p>
                </div>
                <div className="bg-tac-bg-light rounded-lg p-3">
                  <p className="text-xs text-tac-muted">Monthly EBIT Uplift</p>
                  <p className="text-xl font-bold text-tac-success">
                    {formatCurrency(retention.ebitUplift, 0)}
                  </p>
                  <p className="text-xs text-tac-muted mt-1">
                    {formatCurrency(retention.currentEbit, 0)} → {formatCurrency(retention.proposedEbit, 0)}
                  </p>
                </div>
                <div className="bg-tac-bg-light rounded-lg p-3">
                  <p className="text-xs text-tac-muted">Break-Even on TAC</p>
                  <p className="text-2xl font-bold">
                    {retention.breakEvenMonths !== null
                      ? `${retention.breakEvenMonths} month${retention.breakEvenMonths !== 1 ? "s" : ""}`
                      : "N/A"}
                  </p>
                  {retention.tacMonthlyFee > 0 && (
                    <p className="text-xs text-tac-muted mt-1">
                      at {formatCurrency(retention.tacMonthlyFee, 0)}/mo fee
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-3 text-sm text-tac-muted">
                <p>
                  <strong className="text-tac-text">Blended CAC reduction:</strong>{" "}
                  {formatCurrency(retention.currentBlendedCac)} → {formatCurrency(retention.proposedBlendedCac)}{" "}
                  (saving {formatCurrency(retention.currentBlendedCac - retention.proposedBlendedCac)} per order)
                </p>
              </div>
            </>
          ) : (
            <PlaceholderCard title="Retention Model" href="/retention" icon="💰" />
          )}
        </section>

        {/* Footer */}
        <div className="text-center mt-12 pt-8 border-t border-tac-border report-footer">
          <p className="text-tac-accent tracking-[0.3em] text-sm font-light uppercase">
            Prepared by The Aggregate Co.
          </p>
          <p className="text-tac-muted text-xs mt-2">
            Confidential — for client use only
          </p>
          <p className="text-tac-muted text-xs mt-1">{reportDate}</p>
        </div>

        {/* Print Button */}
        <div className="no-print text-center mt-8">
          <button onClick={handlePrint} className="btn-primary">
            Export as PDF (Print)
          </button>
          <p className="text-xs text-tac-muted mt-2">
            Uses your browser&apos;s Print to PDF functionality
          </p>
        </div>
      </main>
    </>
  );
}
