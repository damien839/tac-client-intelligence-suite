"use client";

import { useMemo } from "react";
import {
  CanonicalTier,
  Reconciliation,
  Scheme,
  SchemeEvaluation,
  Segment,
  SegmentOutcome,
  ThresholdCurvePoint,
  TIER_LABELS,
} from "@/lib/shipping-sim/types";
import ReconciliationBadge from "./analysis/ReconciliationBadge";
import AovDistribution, { ThresholdMarker } from "./analysis/AovDistribution";
import { NEUTRAL_COLOR, ReportOption } from "./report/types";
import VerdictCard from "./report/VerdictCard";
import HowToReadCard from "./report/HowToReadCard";
import ContributionDecomposition from "./report/ContributionDecomposition";
import RecoveryFreeShareChart from "./report/RecoveryFreeShareChart";
import SegmentMigration from "./report/SegmentMigration";
import OrderImpactTable from "./report/OrderImpactTable";
import TierMixChart from "./report/TierMixChart";
import ThresholdSensitivityChart from "./report/ThresholdSensitivityChart";
import FindingsCard from "./report/FindingsCard";

interface ComparisonReportProps {
  options: ReportOption[];
  currentFacts: SchemeEvaluation;
  currentScheme: Scheme;
  /** The tier carrying most paid volume — drives the sensitivity sweep and "Now" markers. */
  dominantTier: CanonicalTier | null;
  reconciliation: Reconciliation;
  curves: ThresholdCurvePoint[];
  grossValues: number[];
  /** Buying-behaviour segments of the order book vs the current scheme. */
  segments: Segment[];
  /** Per-option segment outcomes, keyed by option key. */
  outcomesByOption: Record<string, SegmentOutcome[]>;
  /** The unit window the segments were built with (typical unit price or slider). */
  segmentWindow: number;
  monthlyOrders: number | undefined;
  assumptionEcho: string;
  /** Competitor scheme is identical to Current — keep it in charts/tables but out of the verdict ranking. */
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
  segments,
  outcomesByOption,
  segmentWindow,
  monthlyOrders,
  assumptionEcho,
  customIsCurrent,
}: ComparisonReportProps) {
  // Verdict ranking: highest Δ total contribution first; a Competitor benchmark that
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

  // AOV markers: one per numeric free-over line an option CHANGES (deduped within
  // each option — two tiers landing on the same threshold need only one mark).
  // Only tiers where the free threshold genuinely changes (fee-only changes are excluded
  // so we don't draw misleading threshold lines).
  const markers: ThresholdMarker[] = [
    ...(currentThreshold !== null
      ? [{ value: currentThreshold, label: "Now", color: NEUTRAL_COLOR }]
      : []),
    ...options.flatMap((option) => {
      const thresholds = option.changedTiers
        .filter(
          (tier) =>
            option.scheme[tier]?.freeThreshold !== currentScheme[tier]?.freeThreshold &&
            option.scheme[tier]?.freeThreshold !== null &&
            option.scheme[tier]?.freeThreshold !== undefined
        )
        .map((tier) => option.scheme[tier]!.freeThreshold as number);
      return Array.from(new Set(thresholds)).map((value) => ({
        value,
        label: option.shortLabel,
        color: option.color,
      }));
    }),
  ];

  // Sensitivity-chart markers: only options that actually move the swept (dominant)
  // tier's free-over line to a different numeric value get a reference line.
  // Fee-only changes don't shift the threshold and must not draw a misleading line.
  const sensitivityMarkers: ThresholdMarker[] =
    dominantTier === null
      ? []
      : options.flatMap((option) => {
          if (!option.changedTiers.includes(dominantTier)) return [];
          const threshold = option.scheme[dominantTier]?.freeThreshold;
          if (threshold === null || threshold === undefined) return [];
          if (threshold === currentScheme[dominantTier]?.freeThreshold) return [];
          return [{ value: threshold, label: option.shortLabel, color: option.color }];
        });

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

      <HowToReadCard />

      <VerdictCard
        rankedOptions={rankedOptions}
        currentFacts={currentFacts}
        monthlyOrders={monthlyOrders}
      />

      <ContributionDecomposition options={options} currentFacts={currentFacts} />

      <RecoveryFreeShareChart options={options} currentFacts={currentFacts} />

      <SegmentMigration
        segments={segments}
        options={options}
        outcomesByOption={outcomesByOption}
        unitWindow={segmentWindow}
      />

      <OrderImpactTable options={options} />

      <TierMixChart options={options} currentFacts={currentFacts} />

      <AovDistribution grossValues={grossValues} markers={markers} />

      {curves.length > 0 && (
        <ThresholdSensitivityChart
          curves={curves}
          currentThreshold={currentThreshold}
          markers={sensitivityMarkers}
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
