"use client";

import InputField from "@/components/shared/InputField";
import { CanonicalTier, TIER_LABELS } from "@/lib/shipping-sim/types";

interface TierConfigRowProps {
  tier: CanonicalTier;
  fee: number;
  freeThreshold: number | null; // null = flat
  avgCost: number;
  showFeeThreshold?: boolean; // steps 3 & 4
  showAvgCost?: boolean; // step 2
  orderCount?: number; // optional context badge
  onChange: (patch: { fee?: number; freeThreshold?: number | null; avgCost?: number }) => void;
}

export default function TierConfigRow({
  tier,
  fee,
  freeThreshold,
  avgCost,
  showFeeThreshold = false,
  showAvgCost = false,
  orderCount,
  onChange,
}: TierConfigRowProps) {
  const isFlat = freeThreshold === null;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-tac-accent">{TIER_LABELS[tier]}</h4>
        {orderCount !== undefined && (
          <span className="text-xs text-tac-muted">{orderCount} orders</span>
        )}
      </div>

      {showAvgCost && (
        <InputField
          label="Avg carrier cost / order"
          value={avgCost}
          onChange={(v) => onChange({ avgCost: v })}
          prefix="$"
          step={0.5}
          min={0}
          tooltip="What it costs the merchant to ship one order on this service"
        />
      )}

      {showFeeThreshold && (
        <div className="space-y-3 mt-3">
          <InputField
            label="Shipping fee"
            value={fee}
            onChange={(v) => onChange({ fee: v })}
            prefix="$"
            step={0.5}
            min={0}
          />
          <label className="flex items-center gap-2 cursor-pointer text-sm text-tac-text">
            <input
              type="checkbox"
              checked={isFlat}
              onChange={(e) => onChange({ freeThreshold: e.target.checked ? null : 100 })}
              className="accent-tac-accent w-4 h-4"
            />
            Flat rate (no free-shipping threshold)
          </label>
          {!isFlat && (
            <InputField
              label="Free over"
              value={freeThreshold ?? 0}
              onChange={(v) => onChange({ freeThreshold: v })}
              prefix="$"
              step={5}
              min={0}
              tooltip="Orders at or above this cart value ship free on this service"
            />
          )}
        </div>
      )}
    </div>
  );
}
