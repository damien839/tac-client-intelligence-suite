"use client";

import { Analysis, Scheme } from "@/lib/shipping-sim/types";
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

export default function BenchmarkPanel({
  analysis,
  currentScheme,
  proposedScheme,
  monthlyOrders,
}: BenchmarkPanelProps) {
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

  return (
    <div className="space-y-8">
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
