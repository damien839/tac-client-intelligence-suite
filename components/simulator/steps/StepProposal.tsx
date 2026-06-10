"use client";

import { useDeferredValue, useMemo, useState } from "react";
import TierConfigRow from "../TierConfigRow";
import BenchmarkPanel from "../BenchmarkPanel";
import InputField from "@/components/shared/InputField";
import OptionsComparison, { OptionKey } from "../OptionsComparison";
import { analyze } from "@/lib/shipping-sim/analysis";
import { evaluateScheme, recommendOptions } from "@/lib/shipping-sim/recommend";
import {
  BehaviorParams,
  CanonicalTier,
  Scheme,
  TaggedOrder,
} from "@/lib/shipping-sim/types";

const OPTION_LABELS: Record<OptionKey, string> = {
  "profit-first": "Profit-first",
  "threshold-fee": "Optimised threshold + fee",
  "basket-builder": "Basket-builder",
  custom: "Custom",
};

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
  const [selected, setSelected] = useState<OptionKey>("profit-first");

  // Defer the sweep inputs so typing stays responsive while the grids recompute.
  const deferredCogs = useDeferredValue(cogsPercent);
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

  const recs = useMemo(
    () => (behavior ? recommendOptions(orders, currentScheme, behavior) : null),
    [orders, currentScheme, behavior]
  );

  const customEval = useMemo(
    () => (behavior ? evaluateScheme(orders, currentScheme, proposedScheme, behavior) : null),
    [orders, currentScheme, proposedScheme, behavior]
  );

  // Current column = deterministic observed baseline: behaviour zeroed.
  const currentFacts = useMemo(
    () =>
      behavior
        ? evaluateScheme(orders, currentScheme, currentScheme, {
            ...behavior,
            upliftRate: 0,
            abandonRate: 0,
          })
        : null,
    [orders, currentScheme, behavior]
  );

  // Scheme for the selected REC tab (null when custom / recs unavailable).
  // Memoized separately so Custom keystrokes don't change its identity.
  const recScheme = useMemo<Scheme | null>(() => {
    if (selected === "custom" || !recs || !currentScheme.standard) return null;
    const rec = recs.find((r) => r.id === selected);
    if (!rec) return null;
    return {
      ...currentScheme,
      standard: { ...currentScheme.standard, fee: rec.fee, freeThreshold: rec.threshold },
    };
  }, [selected, recs, currentScheme]);

  const selectedScheme = recScheme ?? proposedScheme;

  // recScheme is non-null exactly when a rec tab is active.
  const drilldownKey: OptionKey = recScheme ? selected : "custom";

  const analysis = useMemo(() => {
    if (orders.length === 0 || usedTiers.length === 0) return null;
    return analyze(orders, currentScheme, selectedScheme, { cogsPercent: deferredCogs });
  }, [orders, usedTiers, currentScheme, selectedScheme, deferredCogs]);

  return (
    <div className="space-y-8">
      <OptionsComparison
        recs={recs}
        customEval={customEval}
        currentFacts={currentFacts}
        currentScheme={currentScheme}
        customScheme={proposedScheme}
        cogsPercent={cogsPercent}
        monthlyOrders={monthlyOrders}
        upliftRate={upliftRate}
        upliftWindow={upliftWindow}
        abandonRate={abandonRate}
        echoUpliftRate={deferredUplift}
        echoUpliftWindow={deferredWindow}
        echoAbandonRate={deferredAbandon}
        echoCogsPercent={deferredCogs}
        onCogsChange={onCogsChange}
        onUpliftRateChange={setUpliftRate}
        onUpliftWindowChange={setUpliftWindow}
        onAbandonRateChange={setAbandonRate}
        selected={selected}
        onSelect={setSelected}
        activeKey={drilldownKey}
      />

      <div className="no-print">
        <p className="text-tac-muted mb-4">
          Custom scheme — adjust the fee and free-over threshold per service. It appears as the
          Custom column above and in the drill-down below.
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

      {analysis && (
        <div className="space-y-2">
          <p className="text-xs text-tac-muted">
            Drill-down: <strong className="text-tac-accent">{OPTION_LABELS[drilldownKey]}</strong>{" "}
            — structural comparison at observed cart values. The behaviour assumptions
            (basket-building, abandonment) apply to the comparison table above, not to these
            charts.
          </p>
          <BenchmarkPanel
            analysis={analysis}
            currentScheme={currentScheme}
            proposedScheme={selectedScheme}
            monthlyOrders={monthlyOrders}
          />
        </div>
      )}
    </div>
  );
}
