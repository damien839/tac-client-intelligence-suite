"use client";

import InputField from "@/components/shared/InputField";
import {
  CanonicalTier,
  CANONICAL_TIERS,
  TIER_LABELS,
} from "@/lib/shipping-sim/types";
import { ServiceMap } from "../ShippingSimulatorWizard";

interface StepMapServicesProps {
  services: string[];
  serviceMap: ServiceMap;
  avgCosts: Partial<Record<CanonicalTier, number>>;
  usedTiers: CanonicalTier[];
  onMapChange: (service: string, tier: CanonicalTier | "exclude") => void;
  onAvgCostChange: (tier: CanonicalTier, value: number) => void;
}

export default function StepMapServices({
  services,
  serviceMap,
  avgCosts,
  usedTiers,
  onMapChange,
  onAvgCostChange,
}: StepMapServicesProps) {
  return (
    <div className="space-y-8">
      <div className="card">
        <h3 className="text-lg font-semibold mb-4 text-tac-accent">Map checkout services</h3>
        <div className="space-y-2">
          {services.map((svc) => (
            <div key={svc} className="flex items-center justify-between gap-4">
              <span className="text-sm text-tac-text">{svc}</span>
              <select
                aria-label={`Map service: ${svc}`}
                className="input-field max-w-xs"
                value={serviceMap[svc] ?? ""}
                onChange={(e) => onMapChange(svc, e.target.value as CanonicalTier | "exclude")}
              >
                <option value="" disabled>Assign…</option>
                {CANONICAL_TIERS.map((t) => (
                  <option key={t} value={t}>{TIER_LABELS[t]}</option>
                ))}
                <option value="exclude">Exclude</option>
              </select>
            </div>
          ))}
        </div>
      </div>

      {usedTiers.length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold mb-4 text-tac-accent">Avg carrier cost per order</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {usedTiers.map((t) => (
              <InputField
                key={t}
                label={TIER_LABELS[t]}
                value={avgCosts[t] ?? 0}
                onChange={(v) => onAvgCostChange(t, v)}
                prefix="$"
                step={0.5}
                min={0}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
