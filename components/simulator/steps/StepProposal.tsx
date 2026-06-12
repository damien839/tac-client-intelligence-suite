"use client";

import { useDeferredValue, useMemo, useState } from "react";
import TierConfigRow from "../TierConfigRow";
import InputField from "@/components/shared/InputField";
import OptionsComparison from "../OptionsComparison";
import ComparisonReport from "../ComparisonReport";
import ReconciliationBadge from "../analysis/ReconciliationBadge";
import {
  OPTION_COLORS,
  OPTION_SHORT_LABELS,
  OptionKey,
  ReportOption,
} from "../report/types";
import {
  changedTiersOf,
  dominantPaidTier,
  evaluateScheme,
  recommendOptions,
  thresholdCurves,
} from "@/lib/shipping-sim/recommend";
import { segmentOrders, segmentOutcomes } from "@/lib/shipping-sim/segments";
import {
  BehaviorParams,
  CanonicalTier,
  Reconciliation,
  Scheme,
  SegmentOutcome,
  TaggedOrder,
  UnitStats,
} from "@/lib/shipping-sim/types";

interface StepProposalProps {
  orders: TaggedOrder[];
  usedTiers: CanonicalTier[];
  /** Line-item stats from a full Shopify export — null in summary mode. */
  unitStats: UnitStats | null;
  tierVals: Partial<Record<CanonicalTier, { fee: number; freeThreshold: number | null }>>;
  cogsPercent: number | undefined;
  monthlyOrders: number | undefined;
  currentScheme: Scheme;
  proposedScheme: Scheme; // the Competitor benchmark scheme, built from tierVals by the wizard
  onChange: (tier: CanonicalTier, patch: { fee?: number; freeThreshold?: number | null }) => void;
  onCogsChange: (value: number | undefined) => void;
  onMonthlyOrdersChange: (value: number | undefined) => void;
}

/** The behaviour params each option's evaluation runs with: net-profit forces uplift off. */
function paramsForOption(key: OptionKey, behavior: BehaviorParams): BehaviorParams {
  return key === "net-profit" ? { ...behavior, upliftRate: 0 } : behavior;
}

export default function StepProposal({
  orders,
  usedTiers,
  unitStats,
  tierVals,
  cogsPercent,
  monthlyOrders,
  currentScheme,
  proposedScheme,
  onChange,
  onCogsChange,
  onMonthlyOrdersChange,
}: StepProposalProps) {
  const [upliftRate, setUpliftRate] = useState(0.3);
  const [upliftWindow, setUpliftWindow] = useState(20);
  const [abandonRate, setAbandonRate] = useState(0.1);

  // Defer the sweep inputs so typing stays responsive while the grids recompute.
  const deferredCogs = useDeferredValue(cogsPercent);
  // Deferred so large-file recomputes (rec evaluations) don't run inside the Competitor keystroke render.
  const deferredProposedScheme = useDeferredValue(proposedScheme);
  const deferredUplift = useDeferredValue(upliftRate);
  const deferredWindow = useDeferredValue(upliftWindow);
  const deferredAbandon = useDeferredValue(abandonRate);

  // With line-item data the uplift window is the typical unit price ("one more unit
  // gets you there") for every behavioural evaluation; the slider only drives it in
  // summary mode, where it is the merchant's estimate of a unit.
  const effectiveWindow = unitStats ? unitStats.typicalUnitPrice : deferredWindow;

  const behavior = useMemo<BehaviorParams | null>(() => {
    if (deferredCogs === undefined) return null;
    return {
      cogsPercent: deferredCogs,
      upliftRate: deferredUplift,
      upliftWindow: effectiveWindow,
      abandonRate: deferredAbandon,
    };
  }, [deferredCogs, deferredUplift, effectiveWindow, deferredAbandon]);

  const recs = useMemo(
    () => (behavior ? recommendOptions(orders, currentScheme, behavior, unitStats) : null),
    [orders, currentScheme, behavior, unitStats]
  );

  // The tier carrying most paid volume — drives the sensitivity sweep and "Now" markers.
  const dominantTier = useMemo(() => dominantPaidTier(orders, currentScheme), [orders, currentScheme]);

  const customEval = useMemo(
    () => (behavior ? evaluateScheme(orders, currentScheme, deferredProposedScheme, behavior) : null),
    [orders, currentScheme, deferredProposedScheme, behavior]
  );

  // Current column = deterministic observed baseline: behaviour zeroed. Not gated on
  // COGS — with uplift and abandonment at 0, cogsPercent affects nothing (no margin
  // uplift or abandonment loss to scale), so a constant 0 is correct and keeps this
  // memo independent of deferredCogs.
  const currentFacts = useMemo(
    () =>
      evaluateScheme(orders, currentScheme, currentScheme, {
        cogsPercent: 0,
        upliftRate: 0,
        upliftWindow: 20,
        abandonRate: 0,
      }),
    [orders, currentScheme]
  );

  // The same valid-order set the engine evaluates — drives reconciliation + AOV strip.
  const validOrders = useMemo(
    () => orders.filter((order) => currentScheme[order.tier] !== undefined),
    [orders, currentScheme]
  );

  const grossValues = useMemo(() => validOrders.map((order) => order.gross), [validOrders]);

  const reconciliation = useMemo<Reconciliation | null>(() => {
    if (!currentFacts) return null;
    const actualShippingPaid = validOrders.reduce((sum, order) => sum + order.shippingPaid, 0);
    const modelledCurrentRevenue = currentFacts.shippingRevenue;
    return {
      actualShippingPaid,
      modelledCurrentRevenue,
      variancePct:
        actualShippingPaid > 0
          ? Math.abs(modelledCurrentRevenue - actualShippingPaid) / actualShippingPaid
          : 0,
    };
  }, [validOrders, currentFacts]);

  const curves = useMemo(
    () => (behavior ? thresholdCurves(orders, currentScheme, behavior) : []),
    [orders, currentScheme, behavior]
  );

  // The rec options: each rec carries its full multi-tier scheme; the report renders
  // every changed tier directly. Per-option SchemeEvaluation re-runs the same params
  // the sweep used (net-profit: uplift off; basket-builder: uplift on, window already
  // the typical unit price when line items exist), so it reproduces the rec's deltas.
  const recReportOptions = useMemo<ReportOption[]>(() => {
    if (!behavior || !recs) return [];
    const result: ReportOption[] = [];
    for (const rec of recs) {
      const evaluation = evaluateScheme(
        orders,
        currentScheme,
        rec.scheme,
        paramsForOption(rec.id, behavior)
      );
      if (evaluation) {
        result.push({
          key: rec.id,
          label: rec.label,
          shortLabel: OPTION_SHORT_LABELS[rec.id],
          color: OPTION_COLORS[rec.id],
          scheme: rec.scheme,
          changedTiers: rec.changedTiers,
          evaluation,
          unconstrained: rec.unconstrained,
          capPinned: rec.capPinned,
          matchesCurrent: rec.changedTiers.length === 0,
          ...(rec.basketNarrative !== undefined ? { basketNarrative: rec.basketNarrative } : {}),
        });
      }
    }
    return result;
  }, [behavior, recs, orders, currentScheme]);

  // Competitor benchmark = Current per tier? Then it adds no information and stays
  // out of the verdict ranking. Based on the deferred scheme its evaluation used.
  const customChangedTiers = useMemo(
    () => changedTiersOf(currentScheme, deferredProposedScheme),
    [currentScheme, deferredProposedScheme]
  );
  const customIsCurrent = customChangedTiers.length === 0;

  // Merge rec options with the Competitor benchmark, which reads from
  // deferredProposedScheme so it only recomputes after the keystroke render settles.
  const reportOptions = useMemo<ReportOption[]>(() => {
    const customOption: ReportOption[] = customEval
      ? [
          {
            key: "custom",
            label: "Competitor benchmark",
            shortLabel: OPTION_SHORT_LABELS.custom,
            color: OPTION_COLORS.custom,
            scheme: deferredProposedScheme,
            changedTiers: customChangedTiers,
            evaluation: customEval,
            matchesCurrent: customIsCurrent,
          },
        ]
      : [];
    return [...recReportOptions, ...customOption];
  }, [recReportOptions, customEval, deferredProposedScheme, customChangedTiers, customIsCurrent]);

  // Buying-behaviour segments vs the current scheme, and where each option moves them.
  // Bounded: |options| × |segments| scenario runs over pre-bucketed subsets.
  const segments = useMemo(
    () => segmentOrders(orders, currentScheme, effectiveWindow),
    [orders, currentScheme, effectiveWindow]
  );

  const outcomesByOption = useMemo<Record<string, SegmentOutcome[]>>(() => {
    if (!behavior) return {};
    return Object.fromEntries(
      reportOptions.map((option) => [
        option.key,
        segmentOutcomes(
          orders,
          currentScheme,
          option.scheme,
          paramsForOption(option.key, behavior),
          effectiveWindow
        ),
      ])
    );
  }, [behavior, reportOptions, orders, currentScheme, effectiveWindow]);

  // Single source for the printed assumptions line — built from the deferred values the
  // metrics were actually computed from, so caption and numbers stay consistent mid-drag.
  const windowClause = unitStats
    ? `window auto-set to one unit (~$${Math.round(unitStats.typicalUnitPrice)}) for Basket-builder from your line items`
    : `within $${deferredWindow} below the threshold`;
  const assumptionEcho = `Assumptions: ${Math.round(deferredUplift * 100)}% of orders just below a new threshold build baskets (${windowClause}); ${Math.round(deferredAbandon * 100)}% of worse-off orders abandon per $10 of shipping-cost increase; COGS ${Math.round((deferredCogs ?? 0) * 100)}%. Deltas are expected values vs the observed current baseline over ${currentFacts?.orderCount ?? 0} orders.`;

  return (
    <div className="space-y-8">
      <OptionsComparison
        options={reportOptions}
        currentFacts={currentFacts}
        currentScheme={currentScheme}
        recsEmpty={recs !== null && recs.length === 0}
        cogsPercent={cogsPercent}
        monthlyOrders={monthlyOrders}
        upliftRate={upliftRate}
        upliftWindow={upliftWindow}
        autoWindow={unitStats ? unitStats.typicalUnitPrice : null}
        abandonRate={abandonRate}
        assumptionEcho={assumptionEcho}
        onCogsChange={onCogsChange}
        onUpliftRateChange={setUpliftRate}
        onUpliftWindowChange={setUpliftWindow}
        onAbandonRateChange={setAbandonRate}
      />

      <div className="no-print">
        <p className="text-tac-muted mb-4">
          Competitor benchmark — enter a competitor&apos;s shipping scheme to compare
          like-for-like. It appears as the Competitor benchmark column above and as the
          Competitor option throughout the report below.
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

      {/* Pre-COGS, the option data doesn't exist yet but the reconciliation check does. */}
      {!behavior && reconciliation && <ReconciliationBadge reconciliation={reconciliation} />}

      {behavior && recs && currentFacts && reconciliation && (
        <ComparisonReport
          options={reportOptions}
          currentFacts={currentFacts}
          currentScheme={currentScheme}
          dominantTier={dominantTier}
          reconciliation={reconciliation}
          curves={curves}
          grossValues={grossValues}
          segments={segments}
          outcomesByOption={outcomesByOption}
          segmentWindow={effectiveWindow}
          monthlyOrders={monthlyOrders}
          assumptionEcho={assumptionEcho}
          customIsCurrent={customIsCurrent}
        />
      )}
    </div>
  );
}
