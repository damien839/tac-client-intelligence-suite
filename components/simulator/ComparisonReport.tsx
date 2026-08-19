"use client";

import { useMemo } from "react";
import {
  CanonicalTier,
  CurveStats,
  Scheme,
  SchemeEvaluation,
  Segment,
  SegmentOutcome,
  ThresholdCurvePoint,
  TIER_LABELS,
} from "@/lib/shipping-sim/types";
import { ReportOption, ThresholdMarker } from "./report/types";
import VerdictCard from "./report/VerdictCard";
import HowToReadCard from "./report/HowToReadCard";
import CurveAnatomy from "./report/CurveAnatomy";
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
  /** The tier carrying most volume — drives the sensitivity sweep and "Now" markers. */
  dominantTier: CanonicalTier | null;
  curve: ThresholdCurvePoint[];
  /** Descriptive anatomy of the current order book — drives the Curve Anatomy section. */
  stats: CurveStats;
  /** Segments of the order book vs the current scheme. */
  segments: Segment[];
  /** Per-option segment outcomes, keyed by option id. */
  outcomesByOption: Record<string, SegmentOutcome[]>;
  monthlyOrders: number | undefined;
}

export default function ComparisonReport({
  options,
  currentFacts,
  currentScheme,
  dominantTier,
  curve,
  stats,
  segments,
  outcomesByOption,
  monthlyOrders,
}: ComparisonReportProps) {
  // Candidates that actually differ from the current scheme, in grid order (net
  // shipping P&L delta, descending). Rows identical to Current carry no information.
  const movedOptions = useMemo(
    () => options.filter((option) => !option.isCurrent),
    [options]
  );

  // "Now" marks the swept tier's current free-over line — the one the options re-price.
  const currentThreshold = dominantTier !== null
    ? currentScheme[dominantTier]?.freeThreshold ?? null
    : null;
  const tierLabel = TIER_LABELS[dominantTier ?? "standard"];

  // Sensitivity-chart markers: only options that actually move the swept (dominant)
  // tier's free-over line to a different numeric value get a reference line.
  // Fee-only changes don't shift the threshold and must not draw a misleading line.
  const sensitivityMarkers: ThresholdMarker[] =
    dominantTier === null
      ? []
      : movedOptions.flatMap((option) => {
          if (!option.changedTiers.includes(dominantTier)) return [];
          const threshold = option.scheme[dominantTier]?.freeThreshold;
          if (threshold === null || threshold === undefined) return [];
          if (threshold === currentScheme[dominantTier]?.freeThreshold) return [];
          return [{ value: threshold, label: option.shortLabel, color: option.color }];
        });

  return (
    <div className="space-y-8">
      <HowToReadCard />

      <CurveAnatomy stats={stats} tierLabel={tierLabel} currentThreshold={currentThreshold} />

      <VerdictCard
        movedOptions={movedOptions}
        currentFacts={currentFacts}
        monthlyOrders={monthlyOrders}
      />

      <RecoveryFreeShareChart options={movedOptions} currentFacts={currentFacts} />

      <SegmentMigration
        segments={segments}
        options={movedOptions}
        outcomesByOption={outcomesByOption}
      />

      <OrderImpactTable options={movedOptions} />

      <TierMixChart options={movedOptions} currentFacts={currentFacts} />

      {curve.length > 0 && (
        <ThresholdSensitivityChart
          curve={curve}
          currentThreshold={currentThreshold}
          markers={sensitivityMarkers}
          tierLabel={tierLabel}
        />
      )}

      <FindingsCard
        movedOptions={movedOptions}
        currentFacts={currentFacts}
        monthlyOrders={monthlyOrders}
      />
    </div>
  );
}
