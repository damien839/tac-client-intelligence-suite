"use client";

import { useDeferredValue, useMemo, useState } from "react";
import TierConfigRow from "../TierConfigRow";
import InputField from "@/components/shared/InputField";
import OptionsComparison from "../OptionsComparison";
import ComparisonReport from "../ComparisonReport";
import ReconciliationBadge from "../analysis/ReconciliationBadge";
import { describeStandard } from "../analysis/format";
import {
  OPTION_COLORS,
  OPTION_SHORT_LABELS,
  ReportOption,
} from "../report/types";
import {
  dominantPaidTier,
  evaluateScheme,
  recommendOptions,
  thresholdCurves,
} from "@/lib/shipping-sim/recommend";
import {
  BehaviorParams,
  CanonicalTier,
  Reconciliation,
  Scheme,
  TaggedOrder,
} from "@/lib/shipping-sim/types";

interface StepProposalProps {
  orders: TaggedOrder[];
  usedTiers: CanonicalTier[];
  tierVals: Partial<Record<CanonicalTier, { fee: number; freeThreshold: number | null }>>;
  cogsPercent: number | undefined;
  monthlyOrders: number | undefined;
  currentScheme: Scheme;
  proposedScheme: Scheme; // the Custom scheme, built from tierVals by the wizard
  onChange: (tier: CanonicalTier, patch: { fee?: number; freeThreshold?: number | null }) => void;
  onCogsChange: (value: number | undefined) => void;
  onMonthlyOrdersChange: (value: number | undefined) => void;
}

export default function StepProposal({
  orders,
  usedTiers,
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
  // Deferred so large-file recomputes (rec evaluations) don't run inside the Custom keystroke render.
  const deferredProposedScheme = useDeferredValue(proposedScheme);
  const deferredUplift = useDeferredValue(upliftRate);
  const deferredWindow = useDeferredValue(upliftWindow);
  const deferredAbandon = useDeferredValue(abandonRate);

  const behavior = useMemo<BehaviorParams | null>(() => {
    if (deferredCogs === undefined) return null;
    return {
      cogsPercent: deferredCogs,
      upliftRate: deferredUplift,
      upliftWindow: deferredWindow,
      abandonRate: deferredAbandon,
    };
  }, [deferredCogs, deferredUplift, deferredWindow, deferredAbandon]);

  // unitStats is passed as null for now — Task 4 wires the parsed unit stats through
  // the wizard so the unit-driven basket sweep activates.
  const recs = useMemo(
    () => (behavior ? recommendOptions(orders, currentScheme, behavior, null) : null),
    [orders, currentScheme, behavior]
  );

  // The tier the recommendation sweeps re-price — drives labels and the "Now" markers.
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

  // The rec options: evaluated once per rec change, not on every Custom keystroke.
  // Task-3 mechanical bridge: each rec now carries a full multi-tier scheme; this
  // summarises its first changed tier (or the dominant tier when nothing changed).
  // Task 4 rewires the report to render every changed tier properly.
  const recReportOptions = useMemo<ReportOption[]>(() => {
    if (!behavior || !recs) return [];
    const result: ReportOption[] = [];
    for (const rec of recs) {
      const tier = rec.changedTiers[0] ?? dominantTier ?? "standard";
      const tierConfig = rec.scheme[tier];
      if (!tierConfig) continue;
      // Net-profit forces uplift off (matching recommendOptions); basket-builder uses
      // the full behaviour params — with unitStats null both reproduce the rec's
      // deltas exactly.
      const params =
        rec.id === "basket-builder" ? behavior : { ...behavior, upliftRate: 0 };
      const evaluation = evaluateScheme(orders, currentScheme, rec.scheme, params);
      if (evaluation) {
        result.push({
          key: rec.id,
          label: rec.label,
          shortLabel: OPTION_SHORT_LABELS[rec.id],
          color: OPTION_COLORS[rec.id],
          schemeSummary: describeStandard(rec.scheme[tier]),
          tier,
          threshold: tierConfig.freeThreshold,
          evaluation,
          unconstrained: rec.unconstrained,
          capPinned: rec.capPinned,
          matchesCurrent: rec.changedTiers.length === 0,
        });
      }
    }
    return result;
  }, [behavior, recs, orders, currentScheme, dominantTier]);

  // Custom = Current per used tier (fee + free threshold)? Then it adds no information
  // and stays out of the verdict ranking.
  const customIsCurrent = useMemo(
    () =>
      usedTiers.every((tier) => {
        const current = currentScheme[tier];
        const proposed = proposedScheme[tier];
        if (!current || !proposed) return current === proposed;
        return current.fee === proposed.fee && current.freeThreshold === proposed.freeThreshold;
      }),
    [usedTiers, currentScheme, proposedScheme]
  );

  // Merge rec options with the Custom option. Custom reads from deferredProposedScheme
  // so it only recomputes after the keystroke render has settled. Custom's tier is the
  // dominant tier for labelling only — its scheme carries every tier's configuration.
  const reportOptions = useMemo<ReportOption[]>(() => {
    const customTier = dominantTier ?? "standard";
    const customOption: ReportOption[] = customEval
      ? [
          {
            key: "custom",
            label: "Custom",
            shortLabel: OPTION_SHORT_LABELS.custom,
            color: OPTION_COLORS.custom,
            schemeSummary: describeStandard(deferredProposedScheme[customTier]),
            tier: customTier,
            threshold: deferredProposedScheme[customTier]?.freeThreshold ?? null,
            evaluation: customEval,
            matchesCurrent: customIsCurrent,
          },
        ]
      : [];
    return [...recReportOptions, ...customOption];
  }, [recReportOptions, customEval, deferredProposedScheme, dominantTier, customIsCurrent]);

  // Single source for the printed assumptions line — built from the deferred values the
  // metrics were actually computed from, so caption and numbers stay consistent mid-drag.
  const assumptionEcho = `Assumptions: ${Math.round(deferredUplift * 100)}% of orders within $${deferredWindow} below the threshold build baskets (Basket-builder only); ${Math.round(deferredAbandon * 100)}% of worse-off orders abandon per $10 of shipping-cost increase; COGS ${Math.round((deferredCogs ?? 0) * 100)}%. Deltas are expected values vs the observed current baseline over ${currentFacts?.orderCount ?? 0} orders.`;

  return (
    <div className="space-y-8">
      <OptionsComparison
        options={reportOptions}
        currentFacts={currentFacts}
        currentScheme={currentScheme}
        customScheme={deferredProposedScheme}
        dominantTier={dominantTier}
        recsEmpty={recs !== null && recs.length === 0}
        cogsPercent={cogsPercent}
        monthlyOrders={monthlyOrders}
        upliftRate={upliftRate}
        upliftWindow={upliftWindow}
        abandonRate={abandonRate}
        assumptionEcho={assumptionEcho}
        onCogsChange={onCogsChange}
        onUpliftRateChange={setUpliftRate}
        onUpliftWindowChange={setUpliftWindow}
        onAbandonRateChange={setAbandonRate}
      />

      <div className="no-print">
        <p className="text-tac-muted mb-4">
          Custom scheme — adjust the fee and free-over threshold per service. It appears as the
          Custom column above and as the Custom option throughout the report below.
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
          monthlyOrders={monthlyOrders}
          assumptionEcho={assumptionEcho}
          customIsCurrent={customIsCurrent}
        />
      )}
    </div>
  );
}
