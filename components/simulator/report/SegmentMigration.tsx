"use client";

import {
  ItemBand,
  Segment,
  SegmentOutcome,
  TIER_LABELS,
  ValuePosition,
} from "@/lib/shipping-sim/types";
import { formatPercent } from "@/lib/calculations";
import { ReportOption } from "./types";

interface SegmentMigrationProps {
  /** Buying-behaviour segments of the order book vs the current scheme. */
  segments: Segment[];
  options: ReportOption[];
  /** Per-option segment outcomes, keyed by option key. */
  outcomesByOption: Record<string, SegmentOutcome[]>;
  /** The unit window used to segment — typical unit price when line items exist, else the slider. */
  unitWindow: number;
}

const ITEM_BAND_LABELS: Record<ItemBand, string | null> = {
  single: "1 item",
  double: "2 items",
  threePlus: "3+ items",
  unknown: null, // no line-item data — omit the item part of the label
};

const POSITION_LABELS: Record<ValuePosition, string> = {
  wellBelow: "well below threshold",
  withinOneUnit: "near threshold",
  atOrAbove: "at/above threshold",
};

/** Readable segment name, e.g. "1 item · near threshold · Standard". */
function segmentLabel(segment: Segment): string {
  const parts = [
    ITEM_BAND_LABELS[segment.itemBand],
    POSITION_LABELS[segment.position],
    TIER_LABELS[segment.tier],
  ].filter((part): part is string => part !== null);
  return parts.join(" · ");
}

/** Counts below this render as no movement — matches the report's 1dp display floor. */
const MOVEMENT_FLOOR = 0.05;

/**
 * The dominant movements of one segment under one option: the two largest non-pay
 * movements (build / switch / abandon), e.g. "8.2 build · 1.1 abandon". When nothing
 * moves, the segment keeps paying or shipping free exactly as today.
 */
function movementSummary(outcome: SegmentOutcome | undefined): string {
  if (!outcome) return "no change";
  const movements = [
    { label: "build", value: outcome.builds },
    { label: "switch", value: outcome.switches },
    { label: "abandon", value: outcome.abandons },
  ]
    .filter((movement) => movement.value >= MOVEMENT_FLOOR)
    .sort((a, b) => b.value - a.value)
    .slice(0, 2);
  if (movements.length === 0) return "no change";
  return movements.map((m) => `${m.value.toFixed(1)} ${m.label}`).join(" · ");
}

export default function SegmentMigration({
  segments,
  options,
  outcomesByOption,
  unitWindow,
}: SegmentMigrationProps) {
  if (segments.length === 0) return null;

  // segmentKey -> outcome, per option, for O(1) cell lookups.
  const outcomeMaps = new Map(
    options.map((option) => [
      option.key,
      new Map((outcomesByOption[option.key] ?? []).map((o) => [o.segmentKey, o])),
    ])
  );

  return (
    <div className="card overflow-x-auto">
      <h3 className="text-lg font-semibold mb-1 text-tac-accent">Who moves under each option</h3>
      <p className="text-sm text-tac-muted mb-4">
        Your orders grouped by buying behaviour — how many items they hold and where the cart
        sits vs today&apos;s free-shipping line (&quot;near threshold&quot; = within ~$
        {Math.round(unitWindow)}, one typical unit). For each group, the option columns show the
        expected movement: <em>build</em> = adds items to reach the new threshold,{" "}
        <em>switch</em> = changes service, <em>abandon</em> = walks away. &quot;No change&quot;
        means the group keeps paying or shipping free exactly as today.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-tac-border text-tac-muted">
            <th className="text-left py-2 pr-3 font-normal">Segment</th>
            <th className="text-right py-2 px-3 font-normal">Orders</th>
            <th className="text-right py-2 px-3 font-normal">Value share</th>
            {options.map((option) => (
              <th key={option.key} className="text-right py-2 px-3" style={{ color: option.color }}>
                {option.shortLabel}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {segments.map((segment) => (
            <tr key={segment.key} className="border-b border-tac-border/30">
              <td className="py-2 pr-3 text-tac-muted">{segmentLabel(segment)}</td>
              <td className="text-right py-2 px-3">{segment.orders}</td>
              <td className="text-right py-2 px-3">{formatPercent(segment.valueShare)}</td>
              {options.map((option) => (
                <td key={option.key} className="text-right py-2 px-3">
                  {movementSummary(outcomeMaps.get(option.key)?.get(segment.key))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-tac-muted mt-3">
        Movements are modelled averages — fractions reflect probabilities, not whole orders.
        Totals across all segments are in the order-impact table below.
      </p>
    </div>
  );
}
