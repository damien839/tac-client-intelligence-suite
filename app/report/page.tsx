"use client";

import { useState, useEffect } from "react";
import Nav from "@/components/shared/Nav";

interface ClientProfile {
  clientName: string;
  industry: string;
  auditDate: string;
  currency: string;
}

export default function ReportPage() {
  const [profile, setProfile] = useState<ClientProfile | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("tac-client-profile");
    if (saved) setProfile(JSON.parse(saved));
  }, []);

  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      <div className="no-print">
        <Nav />
      </div>
      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Print Header */}
        <div className="text-center mb-10">
          <p className="text-tac-accent tracking-[0.3em] text-sm font-light uppercase mb-4">
            The Aggregate Co.
          </p>
          <h1 className="text-4xl font-bold mb-2">
            Client Intelligence Report
          </h1>
          {profile && (
            <div className="text-tac-muted mt-4 space-y-1">
              {profile.clientName && (
                <p className="text-lg font-medium text-tac-text">
                  {profile.clientName}
                </p>
              )}
              <p>
                {profile.industry && `${profile.industry} · `}
                {profile.auditDate && `Audit Date: ${profile.auditDate}`}
              </p>
            </div>
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
          <p className="text-tac-muted leading-relaxed mt-3">
            Key findings and recommendations are detailed in each module section
            below. For the most accurate results, ensure all three modules have
            been completed with current data before generating this report.
          </p>
        </section>

        {/* Module 1 Summary */}
        <section className="card mb-8 print-break">
          <h2 className="text-2xl font-semibold text-tac-accent mb-4">
            Module 1: Shipping Strategy
          </h2>
          <p className="text-tac-muted leading-relaxed mb-4">
            The shipping strategy simulator analyses how different free shipping
            thresholds affect profitability by modelling the trade-off between
            shipping cost absorption and revenue from shipping charges.
          </p>
          <div className="bg-tac-bg-light rounded-lg p-4">
            <p className="text-sm text-tac-muted">
              ℹ️ Navigate to the{" "}
              <a href="/simulator" className="text-tac-accent underline">
                Shipping Strategy Simulator
              </a>{" "}
              to run the analysis with your order data. Results will appear here
              once computed.
            </p>
          </div>
          <div className="mt-4 space-y-2 text-sm text-tac-muted">
            <p>
              <strong className="text-tac-text">Key outputs:</strong>
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>AOV distribution and order concentration analysis</li>
              <li>
                Scenario comparison (current vs proposed vs no threshold)
              </li>
              <li>Carrier service level split impact</li>
              <li>Optimal threshold recommendation</li>
              <li>Demand elasticity modelling (if enabled)</li>
            </ul>
          </div>
        </section>

        {/* Module 2 Summary */}
        <section className="card mb-8 print-break">
          <h2 className="text-2xl font-semibold text-tac-accent mb-4">
            Module 2: Cost Audit & Benchmarking
          </h2>
          <p className="text-tac-muted leading-relaxed mb-4">
            The cost audit compares the client&apos;s carrier rates and warehouse
            efficiency metrics against TAC industry benchmarks to surface savings
            opportunities.
          </p>
          <div className="bg-tac-bg-light rounded-lg p-4">
            <p className="text-sm text-tac-muted">
              ℹ️ Navigate to the{" "}
              <a href="/audit" className="text-tac-accent underline">
                Cost Audit
              </a>{" "}
              to upload carrier invoices and warehouse data.
            </p>
          </div>
          <div className="mt-4 space-y-2 text-sm text-tac-muted">
            <p>
              <strong className="text-tac-text">Key outputs:</strong>
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Warehouse efficiency scorecard (RAG status)</li>
              <li>Carrier rate vs benchmark comparison</li>
              <li>Total annual savings opportunity ($)</li>
            </ul>
          </div>
        </section>

        {/* Module 3 Summary */}
        <section className="card mb-8 print-break">
          <h2 className="text-2xl font-semibold text-tac-accent mb-4">
            Module 3: EBIT & Retention Impact
          </h2>
          <p className="text-tac-muted leading-relaxed mb-4">
            The retention model quantifies the EBIT uplift from improving repeat
            purchase rates, demonstrating how lower blended CAC translates
            directly to higher margins.
          </p>
          <div className="bg-tac-bg-light rounded-lg p-4">
            <p className="text-sm text-tac-muted">
              ℹ️ Navigate to the{" "}
              <a href="/retention" className="text-tac-accent underline">
                Retention Model
              </a>{" "}
              to configure inputs and view projections.
            </p>
          </div>
          <div className="mt-4 space-y-2 text-sm text-tac-muted">
            <p>
              <strong className="text-tac-text">Key outputs:</strong>
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Current vs proposed EBIT comparison</li>
              <li>Blended CAC reduction</li>
              <li>12-month cumulative EBIT projection</li>
              <li>TAC engagement break-even period</li>
            </ul>
          </div>
        </section>

        {/* Footer */}
        <div className="text-center mt-12 pt-8 border-t border-tac-border">
          <p className="text-tac-accent tracking-[0.3em] text-sm font-light uppercase">
            Prepared by The Aggregate Co.
          </p>
          <p className="text-tac-muted text-xs mt-2">
            Confidential — for client use only
          </p>
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
