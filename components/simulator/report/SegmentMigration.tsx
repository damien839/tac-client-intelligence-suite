"use client";

import {
  ItemBand,
  Segment,
  SegmentOutcome,
  TIER_LABELS,
  ValuePosition,
} from "@/lib/shipping-sim/types";
import { NEAR_THRESHOLD_BAND } from "@/lib/shipping-sim/segments";
import { formatPercent } from "@/lib/calculations";
import { ReportOption } from "./types";

interface SegmentMigrationProps {
  /** Buying-behaviour segments of the order book vs the current scheme. */
  segments: Segment[];
  options: ReportOption[];
  /** Per-option segment outcomes, keyed by option id. */
  outcomesByOption: Record<string, SegmentOutcome[]>;
}

const ITEM_BAND_LABELS: Record<ItemBand, string | null> = {
  single: "1 item",
  double: "2 items",
  threePlus: "3+ items",
  unknown: null, // no line-item data — omit the item part of the label
};

const POSITION_LABELS: Record<ValuePosition, string> = {
  wellBelow: "well below free line",
  justBelow: "just below free line",
  atOrAbove: "at/above free line",
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

/** Counts below this render as no movement — matches the report's display floor. */
const MOVEMENT_FLOOR = 0.05;

/**
 * How one segment is priced under one option: how many of its orders pay a fee, how
 * many ship free, and how many land on a different service than the customer chose.
 */
function outcomeSummary(
  outcome: SegmentOutcome | undefined,
  baseline: SegmentOutcome | undefined
): string {
  if (!outcome) return "no change";
  const sameSplit =
    baseline !== undefined && Math.abs(outcome.free - baseline.free) < MOVEMENT_FLOOR;
  const parts: string[] = [];
  if (outcome.pays >= MOVEMENT_FLOOR) parts.push(`${outcome.pays.toFixed(0)} pay`);
  if (outcome.free >= MOVEMENT_FLOOR) parts.push(`${outcome.free.toFixed(0)} free`);
  if (outcome.switches >= MOVEMENT_FLOOR) {
    parts.push(`${outcome.switches.toFixed(0)} switch service`);
  }
  if (parts.length === 0) return "no change";
  return sameSplit && outcome.switches < MOVEMENT_FLOOR
    ? `${parts.join(" · ")} (as today)`
    : parts.join(" · ");
}

export default function SegmentMigration({
  segments,
  options,
  outcomesByOption,
}: SegmentMigrationProps) {
  if (segments.length === 0) return null;

  // segmentKey -> outcome, per option, for O(1) cell lookups.
  const outcomeMaps = new Map(
    options.map((option) => [
      option.id,
      new Map((outcomesByOption[option.id] ?? []).map((o) => [o.segmentKey, o])),
    ])
  );
  const currentOutcomes = new Map(
    (outcomesByOption.current ?? []).map((o) => [o.segmentKey, o])
  );

  return (
    <div className="card overflow-x-auto">
      <h3 className="text-lg font-semibold mb-1 text-tac-accent">Who moves under each option</h3>
      <p className="text-sm text-tac-muted mb-4">
        Your orders grouped by how many items they hold and where the cart sits vs today&apos;s
        free-shipping line (&quot;just below&quot; = within ${NEAR_THRESHOLD_BAND} of it). Each
        option column re-prices that group: how many <em>pay</em> a fee, how many ship{" "}
        <em>free</em>, and how many <em>switch service</em> because the candidate prices their
        chosen tier above what they demonstrably paid for it.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-tac-border text-tac-muted">
            <th className="text-left py-2 pr-3 font-normal">Segment</th>
            <th className="text-right py-2 px-3 font-normal">Orders</th>
            <th className="text-right py-2 px-3 font-normal">Value share</th>
            {options.map((option) => (
              <th key={option.id} className="text-right py-2 px-3" style={{ color: option.color }}>
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
                <td key={option.id} className="text-right py-2 px-3">
                  {outcomeSummary(
                    outcomeMaps.get(option.id)?.get(segment.key),
                    currentOutcomes.get(segment.key)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-tac-muted mt-3">
        Counts are whole orders from your upload. Totals across all segments are in the
        order-impact table below.
      </p>
    </div>
  );
}
