"use client";

import { Analysis, CANONICAL_TIERS, Scheme, TierConfig, TIER_LABELS } from "@/lib/shipping-sim/types";
import VerdictHeader from "./analysis/VerdictHeader";
import ReconciliationBadge from "./analysis/ReconciliationBadge";
import ProfitBridge from "./analysis/ProfitBridge";
import RecoveryGauges from "./analysis/RecoveryGauges";
import TierEconomicsTable from "./analysis/TierEconomicsTable";
import MovementTable from "./analysis/MovementTable";
import CarrierMixChart from "./analysis/CarrierMixChart";
import AovDistribution, { ThresholdMarker } from "./analysis/AovDistribution";
import ThresholdSweepChart from "./analysis/ThresholdSweepChart";
import Findings from "./analysis/Findings";

interface BenchmarkPanelProps {
  analysis: Analysis;
  currentScheme: Scheme;
  proposedScheme: Scheme;
  monthlyOrders?: number;
}

function describeTier(config?: TierConfig): string {
  if (!config) return "—";
  return config.freeThreshold === null
    ? `$${config.fee} flat`
    : `$${config.fee}, free over $${config.freeThreshold}`;
}

function handleExport() {
  const previous = document.title;
  document.title = "Shipping Strategy Analysis";
  const restore = () => {
    document.title = previous;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  window.print();
}

export default function BenchmarkPanel({
  analysis,
  currentScheme,
  proposedScheme,
  monthlyOrders,
}: BenchmarkPanelProps) {
  const tiers = CANONICAL_TIERS.filter((t) => currentScheme[t] || proposedScheme[t]);

  // AOV threshold markers (only tiers with a real free-over line)
  const markers: ThresholdMarker[] = [];
  const cs = currentScheme.standard;
  const ps = proposedScheme.standard;
  const ce = currentScheme.express;
  const pe = proposedScheme.express;
  if (cs && cs.freeThreshold !== null) markers.push({ value: cs.freeThreshold, label: "Std now", color: "#A0AEB8" });
  if (ps && ps.freeThreshold !== null) markers.push({ value: ps.freeThreshold, label: "Std new", color: "#F5B36B" });
  if (ce && ce.freeThreshold !== null) markers.push({ value: ce.freeThreshold, label: "Exp now", color: "#6088aa" });
  if (pe && pe.freeThreshold !== null) markers.push({ value: pe.freeThreshold, label: "Exp new", color: "#c08a4a" });

  const currentStdThreshold = cs && cs.freeThreshold !== null ? cs.freeThreshold : 0;
  const proposedStdThreshold = ps && ps.freeThreshold !== null ? ps.freeThreshold : 0;

  const reportDate = new Date().toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-8">
      {/* Export toolbar (screen only) */}
      <div className="no-print flex items-center justify-between">
        <p className="text-sm text-tac-muted">Live analysis — export a client-ready PDF →</p>
        <button type="button" onClick={handleExport} className="btn-secondary">
          ⬇ Download PDF
        </button>
      </div>

      {/* Report header (PDF only) */}
      <div className="hidden print:block">
        <h1 className="text-2xl font-bold text-tac-accent">Shipping Strategy Analysis</h1>
        <p className="text-sm text-tac-muted">The Aggregate Co · {reportDate}</p>
        <div className="mt-3 text-sm">
          {tiers.map((t) => (
            <p key={t}>
              <span className="font-semibold">{TIER_LABELS[t]}:</span> {describeTier(currentScheme[t])} →{" "}
              {describeTier(proposedScheme[t])}
            </p>
          ))}
        </div>
      </div>

      <VerdictHeader analysis={analysis} />

      <ReconciliationBadge reconciliation={analysis.benchmark.reconciliation} />

      <ProfitBridge benchmark={analysis.benchmark} />

      <RecoveryGauges current={analysis.recoveryCurrent} proposed={analysis.recoveryProposed} />

      <TierEconomicsTable
        current={analysis.tierEconomicsCurrent}
        proposed={analysis.tierEconomicsProposed}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MovementTable movement={analysis.movement} />
        <CarrierMixChart current={analysis.benchmark.current} proposed={analysis.benchmark.proposed} />
      </div>

      <AovDistribution movement={analysis.movement} markers={markers} />

      <ThresholdSweepChart
        sweep={analysis.thresholdSweep}
        optimalThreshold={analysis.optimalThreshold}
        optimalNet={analysis.optimalNet}
        currentThreshold={currentStdThreshold}
        proposedThreshold={proposedStdThreshold}
      />

      <Findings analysis={analysis} monthlyOrders={monthlyOrders} />
    </div>
  );
}
