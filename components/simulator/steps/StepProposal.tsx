"use client";

import { useDeferredValue, useMemo } from "react";
import TierConfigRow from "../TierConfigRow";
import InputField from "@/components/shared/InputField";
import OptionsComparison from "../OptionsComparison";
import ComparisonReport from "../ComparisonReport";
import ReconciliationBadge from "../analysis/ReconciliationBadge";
import ReportHeader from "../report/ReportHeader";
import { optionColor, ReportOption } from "../report/types";
import { buildCandidates, evaluateCandidates } from "@/lib/shipping-sim/candidates";
import {
  evaluateScheme,
  isCurrentSchemeEntered,
  thresholdCurve,
} from "@/lib/shipping-sim/evaluate";
import { dominantTier as dominantTierOf } from "@/lib/shipping-sim/scenario";
import { buildReconciliation } from "@/lib/shipping-sim/reconcile";
import { segmentOrders, segmentOutcomes } from "@/lib/shipping-sim/segments";
import { curveStats } from "@/lib/shipping-sim/curve";
import {
  CanonicalTier,
  Reconciliation,
  Scheme,
  SegmentOutcome,
  TaggedOrder,
} from "@/lib/shipping-sim/types";

interface StepProposalProps {
  orders: TaggedOrder[];
  usedTiers: CanonicalTier[];
  tierVals: Partial<Record<CanonicalTier, { fee: number; freeThreshold: number | null }>>;
  monthlyOrders: number | undefined;
  currentScheme: Scheme;
  proposedScheme: Scheme; // the Competitor benchmark scheme, built from tierVals by the wizard
  onChange: (tier: CanonicalTier, patch: { fee?: number; freeThreshold?: number | null }) => void;
  onMonthlyOrdersChange: (value: number | undefined) => void;
}

export default function StepProposal({
  orders,
  usedTiers,
  tierVals,
  monthlyOrders,
  currentScheme,
  proposedScheme,
  onChange,
  onMonthlyOrdersChange,
}: StepProposalProps) {
  // Deferred so large-file recomputes don't run inside the Competitor keystroke render.
  const deferredProposedScheme = useDeferredValue(proposedScheme);

  // THE GATE. Step 2 seeds every used tier with {fee: 0, freeThreshold: null} so the
  // user can page forward, so "the tier exists" does not mean "the user entered it".
  // Everything below the placeholder is gated on this single predicate — see
  // isCurrentSchemeEntered for the invariant.
  const schemeEntered = useMemo(() => isCurrentSchemeEntered(currentScheme), [currentScheme]);

  // The tier carrying most volume — drives the sensitivity sweep and "Now" markers.
  const dominantTier = useMemo(
    () => dominantTierOf(orders, currentScheme),
    [orders, currentScheme]
  );

  // The comparison grid: current + round-number candidates + the competitor benchmark.
  const candidates = useMemo(
    () => buildCandidates(orders, currentScheme, deferredProposedScheme),
    [orders, currentScheme, deferredProposedScheme]
  );

  const reportOptions = useMemo<ReportOption[]>(
    () =>
      evaluateCandidates(orders, currentScheme, candidates).map((row, index) => ({
        ...row.candidate,
        color: optionColor(index),
        evaluation: row.evaluation,
      })),
    [orders, currentScheme, candidates]
  );

  // Current scheme vs itself — the deterministic observed baseline.
  const currentFacts = useMemo(
    () => evaluateScheme(orders, currentScheme, currentScheme),
    [orders, currentScheme]
  );

  // The same valid-order set the engine evaluates — drives reconciliation + AOV strip.
  const validOrders = useMemo(
    () => orders.filter((order) => currentScheme[order.tier] !== undefined),
    [orders, currentScheme]
  );

  // Descriptive anatomy of the current order book — drives the Curve Anatomy section.
  const stats = useMemo(
    () => curveStats(validOrders, currentScheme, dominantTier),
    [validOrders, currentScheme, dominantTier]
  );

  const reconciliation = useMemo<Reconciliation | null>(
    () => (currentFacts ? buildReconciliation(validOrders, currentFacts) : null),
    [validOrders, currentFacts]
  );

  const curve = useMemo(() => thresholdCurve(orders, currentScheme), [orders, currentScheme]);

  // Order-book segments vs the current scheme, and where each candidate moves them.
  const segments = useMemo(() => segmentOrders(orders, currentScheme), [orders, currentScheme]);

  const outcomesByOption = useMemo<Record<string, SegmentOutcome[]>>(
    () =>
      Object.fromEntries(
        reportOptions.map((option) => [
          option.id,
          segmentOutcomes(orders, currentScheme, option.scheme),
        ])
      ),
    [reportOptions, orders, currentScheme]
  );

  if (!schemeEntered) {
    return (
      <div className="card border-l-2 border-l-tac-warning">
        <h3 className="text-lg font-semibold mb-1 text-tac-accent">
          Enter your current shipping scheme first
        </h3>
        <p className="text-sm text-tac-muted">
          Every service is still set to $0 with no free-shipping threshold, so every
          candidate would re-price your orders to exactly the same $0 and the whole report
          would read +$0.00. Go back to <strong>Current state</strong> and enter the fee and
          free-over line you actually charge on at least one service.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <ReportHeader />

      {reconciliation && <ReconciliationBadge reconciliation={reconciliation} />}

      <OptionsComparison
        options={reportOptions}
        currentScheme={currentScheme}
        candidatesEmpty={candidates.length === 0}
        monthlyOrders={monthlyOrders}
      />

      <div className="no-print">
        <p className="text-tac-muted mb-4">
          Competitor benchmark — enter a competitor&apos;s shipping scheme to compare
          like-for-like. It appears as the Competitor benchmark row above and as the Competitor
          option throughout the report below.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {usedTiers.map((t) => (
            <TierConfigRow
              key={t}
              tier={t}
              fee={tierVals[t]?.fee ?? 0}
              freeThreshold={tierVals[t]?.freeThreshold ?? null}
              avgCost={0}
              showFeeThreshold
              onChange={(patch) => onChange(t, patch)}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 no-print">
        <div className="card">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-tac-text mb-3">
            <input
              type="checkbox"
              checked={monthlyOrders !== undefined}
              onChange={(e) => onMonthlyOrdersChange(e.target.checked ? 2000 : undefined)}
              className="accent-tac-accent w-4 h-4"
            />
            Project monthly / annual impact (optional)
          </label>
          {monthlyOrders !== undefined && (
            <InputField
              label="Monthly order volume"
              value={monthlyOrders}
              onChange={(v) => onMonthlyOrdersChange(v)}
              step={100}
              min={0}
              tooltip="Used only to scale the per-order impact — clearly labelled as illustrative"
            />
          )}
        </div>
      </div>

      {currentFacts && (
        <ComparisonReport
          options={reportOptions}
          currentFacts={currentFacts}
          currentScheme={currentScheme}
          dominantTier={dominantTier}
          curve={curve}
          stats={stats}
          segments={segments}
          outcomesByOption={outcomesByOption}
          monthlyOrders={monthlyOrders}
        />
      )}
    </div>
  );
}
