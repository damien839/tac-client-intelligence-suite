"use client";

import { useMemo } from "react";
import {
  CanonicalTier,
  Reconciliation,
  Scheme,
  SchemeEvaluation,
  ThresholdCurvePoint,
  TIER_LABELS,
} from "@/lib/shipping-sim/types";
import ReconciliationBadge from "./analysis/ReconciliationBadge";
import AovDistribution, { ThresholdMarker } from "./analysis/AovDistribution";
import { NEUTRAL_COLOR, ReportOption } from "./report/types";
import VerdictCard from "./report/VerdictCard";
import ContributionDecomposition from "./report/ContributionDecomposition";
import RecoveryFreeShareChart from "./report/RecoveryFreeShareChart";
import OrderImpactTable from "./report/OrderImpactTable";
import TierMixChart from "./report/TierMixChart";
import ThresholdSensitivityChart from "./report/ThresholdSensitivityChart";
import FindingsCard from "./report/FindingsCard";

interface ComparisonReportProps {
  options: ReportOption[];
  currentFacts: SchemeEvaluation;
  currentScheme: Scheme;
  /** The tier the recommendations re-price — drives the "Now" markers and chart labels. */
  dominantTier: CanonicalTier | null;
  reconciliation: Reconciliation;
  curves: ThresholdCurvePoint[];
  grossValues: number[];
  monthlyOrders: number | undefined;
  assumptionEcho: string;
  /** Custom scheme is identical to Current — keep it in charts/tables but out of the verdict ranking. */
  customIsCurrent: boolean;
}

function handleExport() {
  const previous = document.title;
  document.title = "Shipping Strategy Options Report";
  const restore = () => {
    document.title = previous;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  window.print();
}

export default function ComparisonReport({
  options,
  currentFacts,
  currentScheme,
  dominantTier,
  reconciliation,
  curves,
  grossValues,
  monthlyOrders,
  assumptionEcho,
  customIsCurrent,
}: ComparisonReportProps) {
  // Verdict ranking: highest Δ total contribution first; a Custom scheme that
  // merely restates Current carries no information, so it stays out of the narrative.
  const rankedOptions = useMemo(
    () =>
      options
        .filter((option) => !(option.key === "custom" && customIsCurrent))
        .toSorted((a, b) => b.evaluation.contributionDelta - a.evaluation.contributionDelta),
    [options, customIsCurrent]
  );

  // "Now" marks the swept tier's current free-over line — the one the options re-price.
  const currentThreshold = dominantTier !== null
    ? currentScheme[dominantTier]?.freeThreshold ?? null
    : null;
  const tierLabel = TIER_LABELS[dominantTier ?? "standard"];

  const markers: ThresholdMarker[] = [
    ...(currentThreshold !== null
      ? [{ value: currentThreshold, label: "Now", color: NEUTRAL_COLOR }]
      : []),
    ...options
      .filter((option) => option.threshold !== null)
      .map((option) => ({
        value: option.threshold!,
        label: option.shortLabel,
        color: option.color,
      })),
  ];

  const reportDate = new Date().toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-8">
      {/* Export toolbar (screen only) */}
      <div className="no-print flex items-center justify-between">
        <p className="text-sm text-tac-muted">Comparative report — export a client-ready PDF →</p>
        <button type="button" onClick={handleExport} className="btn-secondary">
          ⬇ Download PDF
        </button>
      </div>

      {/* Report header (PDF only) */}
      <div className="hidden print:block">
        <h1 className="text-2xl font-bold text-tac-accent">Shipping Strategy Options Report</h1>
        <p className="text-sm text-tac-muted">The Aggregate Co · {reportDate}</p>
      </div>

      <ReconciliationBadge reconciliation={reconciliation} />

      <VerdictCard
        rankedOptions={rankedOptions}
        currentFacts={currentFacts}
        monthlyOrders={monthlyOrders}
      />

      <ContributionDecomposition options={options} currentFacts={currentFacts} />

      <RecoveryFreeShareChart options={options} currentFacts={currentFacts} />

      <OrderImpactTable options={options} />

      <TierMixChart options={options} currentFacts={currentFacts} />

      <AovDistribution grossValues={grossValues} markers={markers} />

      {curves.length > 0 && (
        <ThresholdSensitivityChart
          curves={curves}
          currentThreshold={currentThreshold}
          options={options}
          tierLabel={tierLabel}
        />
      )}

      <FindingsCard
        rankedOptions={rankedOptions}
        currentFacts={currentFacts}
        monthlyOrders={monthlyOrders}
        assumptionEcho={assumptionEcho}
      />
    </div>
  );
}
