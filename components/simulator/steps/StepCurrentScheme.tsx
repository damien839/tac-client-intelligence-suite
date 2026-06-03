"use client";

import { useMemo } from "react";
import TierConfigRow from "../TierConfigRow";
import { CanonicalTier, TaggedOrder } from "@/lib/shipping-sim/types";
import { formatPercent } from "@/lib/calculations";

interface StepCurrentSchemeProps {
  orders: TaggedOrder[];
  usedTiers: CanonicalTier[];
  avgCosts: Partial<Record<CanonicalTier, number>>;
  tierVals: Partial<Record<CanonicalTier, { fee: number; freeThreshold: number | null }>>;
  onChange: (tier: CanonicalTier, patch: { fee?: number; freeThreshold?: number | null }) => void;
}

export default function StepCurrentScheme({
  orders,
  usedTiers,
  avgCosts,
  tierVals,
  onChange,
}: StepCurrentSchemeProps) {
  const counts = useMemo(() => {
    const c: Partial<Record<CanonicalTier, number>> = {};
    for (const o of orders) c[o.tier] = (c[o.tier] ?? 0) + 1;
    return c;
  }, [orders]);

  return (
    <div>
      <p className="text-tac-muted mb-4">
        Enter the merchant&apos;s current shipping fee and free-over threshold for each service.
        Tick &quot;flat rate&quot; for services with no free-shipping threshold.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {usedTiers.map((t) => (
          <TierConfigRow
            key={t}
            tier={t}
            fee={tierVals[t]?.fee ?? 0}
            freeThreshold={tierVals[t]?.freeThreshold ?? null}
            avgCost={avgCosts[t] ?? 0}
            showFeeThreshold
            orderCount={counts[t] ?? 0}
            onChange={(patch) => onChange(t, patch)}
          />
        ))}
      </div>
      <p className="text-xs text-tac-muted mt-4">
        Share of orders:{" "}
        {usedTiers
          .map((t) => `${t} ${formatPercent((counts[t] ?? 0) / Math.max(orders.length, 1))}`)
          .join(" · ")}
      </p>
    </div>
  );
}
