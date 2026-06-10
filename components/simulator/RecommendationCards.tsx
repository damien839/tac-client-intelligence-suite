"use client";

import { useDeferredValue, useMemo, useState } from "react";
import InputField from "@/components/shared/InputField";
import { recommendOptions } from "@/lib/shipping-sim/recommend";
import {
  BehaviorParams,
  RecommendedScheme,
  Scheme,
  TaggedOrder,
} from "@/lib/shipping-sim/types";
import { formatCurrency, formatPercent } from "@/lib/calculations";

interface RecommendationCardsProps {
  orders: TaggedOrder[];
  currentScheme: Scheme;
  proposedStandard: { fee: number; freeThreshold: number | null } | undefined;
  cogsPercent: number | undefined;
  onCogsChange: (value: number | undefined) => void;
  onApply: (patch: { fee: number; freeThreshold: number | null }) => void;
}

function signedCurrency(value: number): string {
  const normalized = value === 0 ? 0 : value; // avoid "+-$0.00" from negative zero
  return `${normalized >= 0 ? "+" : ""}${formatCurrency(normalized)}`;
}

/** Fraction -> percent for display, rounded to 0.1 to hide float artifacts (0.55 -> 55, not 55.00000000000001). */
function toPercent(fraction: number): number {
  return Math.round(fraction * 1000) / 10;
}

export default function RecommendationCards({
  orders,
  currentScheme,
  proposedStandard,
  cogsPercent,
  onCogsChange,
  onApply,
}: RecommendationCardsProps) {
  const [upliftRate, setUpliftRate] = useState(0.3);
  const [upliftWindow, setUpliftWindow] = useState(20);
  const [abandonRate, setAbandonRate] = useState(0.1);

  // Defer the sweep inputs so typing in the assumption fields stays responsive
  // while the grid sweep recomputes (can take ~1s on pathological datasets).
  const deferredCogs = useDeferredValue(cogsPercent);
  const deferredUplift = useDeferredValue(upliftRate);
  const deferredWindow = useDeferredValue(upliftWindow);
  const deferredAbandon = useDeferredValue(abandonRate);

  const recs = useMemo<RecommendedScheme[] | null>(() => {
    if (deferredCogs === undefined) return null;
    const behavior: BehaviorParams = {
      cogsPercent: deferredCogs,
      upliftRate: deferredUplift,
      upliftWindow: deferredWindow,
      abandonRate: deferredAbandon,
    };
    return recommendOptions(orders, currentScheme, behavior);
  }, [orders, currentScheme, deferredCogs, deferredUplift, deferredWindow, deferredAbandon]);

  if (!currentScheme.standard) {
    return (
      <div className="card">
        <h3 className="text-lg font-semibold mb-2 text-tac-accent">Recommended schemes</h3>
        <p className="text-sm text-tac-muted">
          Recommendations target the standard free-over line — map a service to Standard to
          enable them.
        </p>
      </div>
    );
  }

  const assumptionLine = (rec: RecommendedScheme): string => {
    const abandon = `${Math.round(abandonRate * 100)}% of worse-off orders abandon`;
    const cogs = `COGS ${Math.round((cogsPercent ?? 0) * 100)}%`;
    if (rec.id === "basket-builder") {
      return `${Math.round(upliftRate * 100)}% of orders within $${upliftWindow} below the threshold build baskets; ${abandon}; ${cogs}`;
    }
    return `No basket-building assumed; ${abandon}; ${cogs}`;
  };

  const isApplied = (rec: RecommendedScheme): boolean =>
    proposedStandard !== undefined &&
    proposedStandard.fee === rec.fee &&
    proposedStandard.freeThreshold === rec.threshold;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-tac-accent">Recommended schemes</h3>

      {/* Assumptions panel — inputs hidden in print; each card echoes its assumptions */}
      <div className="card no-print">
        <p className="text-sm text-tac-muted mb-3">
          Behavioural assumptions. Every number below shows its inputs — drag these to
          stress-test the recommendations.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <InputField
            label="COGS %"
            value={toPercent(cogsPercent ?? 0)}
            onChange={(v) => onCogsChange(v / 100)}
            suffix="%"
            step={1}
            min={0}
            max={100}
            tooltip="Required — values the product margin gained by basket-building and lost to abandonment"
          />
          <InputField
            label="Basket uplift"
            value={toPercent(upliftRate)}
            onChange={(v) => setUpliftRate(v / 100)}
            suffix="%"
            step={5}
            min={0}
            max={100}
            tooltip="Share of orders just below the threshold that add items to qualify"
          />
          <InputField
            label="Uplift window"
            value={upliftWindow}
            onChange={setUpliftWindow}
            prefix="$"
            step={5}
            min={0}
            tooltip="How far below the threshold an order can be and still build to it"
          />
          <InputField
            label="Abandonment"
            value={toPercent(abandonRate)}
            onChange={(v) => setAbandonRate(v / 100)}
            suffix="%"
            step={1}
            min={0}
            max={100}
            tooltip="Share of orders facing a higher shipping cost than today that abandon"
          />
        </div>
      </div>

      {cogsPercent === undefined ? (
        <div className="card no-print">
          <p className="text-sm text-tac-warning">
            Enter a COGS % above to enable recommendations — without it, basket-building
            gains and abandonment losses can&apos;t be valued.
          </p>
        </div>
      ) : (
        recs &&
        recs.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {recs.map((rec) => (
              <div key={rec.id} className="card flex flex-col">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="font-semibold text-tac-accent">{rec.label}</h4>
                  {isApplied(rec) && (
                    <span className="text-xs text-tac-success">Applied ✓</span>
                  )}
                </div>
                <p className="text-xl font-bold text-tac-text">
                  {rec.threshold === null
                    ? "Flat rate — no free shipping"
                    : `Free over $${rec.threshold}`}
                </p>
                <p className="text-xs text-tac-muted mb-3">
                  Standard fee ${rec.fee}
                  {rec.id !== "threshold-fee" && " (unchanged)"}
                </p>

                <dl className="text-sm space-y-1 mb-3">
                  <div className="flex justify-between">
                    <dt className="text-tac-muted">Δ total contribution</dt>
                    <dd className="font-semibold text-tac-accent">
                      {signedCurrency(rec.contributionDelta)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-tac-muted">Δ net shipping profit</dt>
                    <dd>{signedCurrency(rec.netShippingProfitDelta)}</dd>
                  </div>
                  {rec.upliftMarginGain > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-tac-muted">Basket margin gain</dt>
                      <dd>{signedCurrency(rec.upliftMarginGain)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-tac-muted">Abandonment margin loss</dt>
                    <dd>{signedCurrency(-rec.abandonMarginLoss)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-tac-muted">Expected orders lost</dt>
                    <dd>{rec.expectedOrdersLost.toFixed(1)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-tac-muted">Free-order share</dt>
                    <dd>{formatPercent(rec.freeOrderShare)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-tac-muted">Cost recovery</dt>
                    <dd>{formatPercent(rec.recoveryRate)}</dd>
                  </div>
                </dl>

                <p className="text-xs text-tac-muted mb-3">{assumptionLine(rec)}</p>

                {rec.unconstrained && (
                  <p className="text-xs text-tac-warning mb-3">
                    Abandonment is 0% — nothing stops &quot;charge everyone more&quot;, so this
                    optimum may be unreliable. Set an abandonment rate before trusting it.
                  </p>
                )}

                <button
                  type="button"
                  className="btn-primary mt-auto no-print"
                  disabled={isApplied(rec)}
                  onClick={() => onApply({ fee: rec.fee, freeThreshold: rec.threshold })}
                >
                  {isApplied(rec) ? "Applied" : "Apply to proposal"}
                </button>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
