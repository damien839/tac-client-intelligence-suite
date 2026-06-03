"use client";

import TierConfigRow from "../TierConfigRow";
import BenchmarkPanel from "../BenchmarkPanel";
import InputField from "@/components/shared/InputField";
import { Benchmark, CanonicalTier } from "@/lib/shipping-sim/types";

interface StepProposalProps {
  usedTiers: CanonicalTier[];
  tierVals: Partial<Record<CanonicalTier, { fee: number; freeThreshold: number | null }>>;
  cogsPercent: number | undefined;
  benchmark: Benchmark | null;
  onChange: (tier: CanonicalTier, patch: { fee?: number; freeThreshold?: number | null }) => void;
  onCogsChange: (value: number | undefined) => void;
}

export default function StepProposal({
  usedTiers,
  tierVals,
  cogsPercent,
  benchmark,
  onChange,
  onCogsChange,
}: StepProposalProps) {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-tac-muted mb-4">
          Adjust the proposed fee and free-over threshold per service. The benchmark below updates live.
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

      <div className="card max-w-sm">
        <label className="flex items-center gap-2 cursor-pointer text-sm text-tac-text mb-3">
          <input
            type="checkbox"
            checked={cogsPercent !== undefined}
            onChange={(e) => onCogsChange(e.target.checked ? 0.3 : undefined)}
            className="accent-tac-accent w-4 h-4"
          />
          Add COGS % for full-margin context (optional)
        </label>
        {cogsPercent !== undefined && (
          <InputField
            label="COGS %"
            value={cogsPercent * 100}
            onChange={(v) => onCogsChange(v / 100)}
            suffix="%"
            step={1}
            min={0}
            max={100}
          />
        )}
      </div>

      {benchmark && <BenchmarkPanel benchmark={benchmark} />}
    </div>
  );
}
