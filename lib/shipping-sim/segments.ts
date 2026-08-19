import { bucketOrders, mechanicalScenario, prepareBuckets } from "./scenario";
import {
  ItemBand,
  Scheme,
  Segment,
  SegmentOutcome,
  TaggedOrder,
  TierConfig,
  ValuePosition,
} from "./types";

/**
 * Descriptive band for "just below the free-shipping line", in dollars. A fixed
 * reporting constant — it matches the $25 rounding of the candidate thresholds and
 * is NOT an assumption about what shoppers do with that gap.
 */
export const NEAR_THRESHOLD_BAND = 25;

function itemBandOf(units: number | undefined): ItemBand {
  if (units === undefined || units < 1) return "unknown";
  if (units === 1) return "single";
  if (units === 2) return "double";
  return "threePlus";
}

/**
 * Position of an order's value vs its CURRENT tier's free threshold.
 * Flat tiers (no threshold) have no line to sit below, so orders are "wellBelow" —
 * unless the flat fee is 0, where everyone already ships free and the segment reads
 * "atOrAbove". (A flat tier with a positive fee can never be at/above a threshold
 * that does not exist.)
 */
function positionOf(gross: number, config: TierConfig): ValuePosition {
  if (config.freeThreshold === null) {
    return config.fee === 0 ? "atOrAbove" : "wellBelow";
  }
  if (gross >= config.freeThreshold) return "atOrAbove";
  if (gross >= config.freeThreshold - NEAR_THRESHOLD_BAND) return "justBelow";
  return "wellBelow";
}

function keyOf(order: TaggedOrder, current: Scheme): string {
  const itemBand = itemBandOf(order.units);
  const position = positionOf(order.gross, current[order.tier]!);
  return `${itemBand}|${position}|${order.tier}`;
}

/**
 * Static segmentation of the order book vs the CURRENT scheme: item-count band
 * (from line-item data; "unknown" without it) x value position vs the order's
 * current tier threshold x chosen tier. Empty segments are omitted; output is
 * sorted by order count (desc), then key.
 */
export function segmentOrders(orders: TaggedOrder[], current: Scheme): Segment[] {
  const valid = orders.filter((order) => current[order.tier] !== undefined);
  if (valid.length === 0) return [];
  const totalGross = valid.reduce((sum, order) => sum + order.gross, 0);

  const counts = new Map<string, { orders: number; gross: number }>();
  for (const order of valid) {
    const key = keyOf(order, current);
    const entry = counts.get(key);
    counts.set(
      key,
      entry
        ? { orders: entry.orders + 1, gross: entry.gross + order.gross }
        : { orders: 1, gross: order.gross }
    );
  }

  return Array.from(counts.entries())
    .map(([key, entry]): Segment => {
      const [itemBand, position, tier] = key.split("|") as [
        ItemBand,
        ValuePosition,
        Segment["tier"],
      ];
      return {
        key,
        itemBand,
        position,
        tier,
        orders: entry.orders,
        valueShare: totalGross > 0 ? entry.gross / totalGross : 0,
      };
    })
    .sort((a, b) => b.orders - a.orders || a.key.localeCompare(b.key));
}

/**
 * Mechanical outcome of each segment under a candidate scheme: how many of the
 * segment's orders pay a fee, how many ship free, and how many land on a different
 * service than the customer chose. Segments partition the analysable orders and
 * `mechanicalScenario` is additive over buckets, so per-segment outcomes sum
 * exactly to the whole-book result.
 */
export function segmentOutcomes(
  orders: TaggedOrder[],
  current: Scheme,
  candidate: Scheme
): SegmentOutcome[] {
  const valid = orders.filter((order) => current[order.tier] !== undefined);
  if (valid.length === 0) return [];

  const groups = new Map<string, TaggedOrder[]>();
  for (const order of valid) {
    const key = keyOf(order, current);
    const group = groups.get(key);
    if (group) {
      group.push(order);
    } else {
      groups.set(key, [order]);
    }
  }

  return segmentOrders(orders, current).map((segment): SegmentOutcome => {
    const subset = groups.get(segment.key) ?? [];
    const prepared = prepareBuckets(bucketOrders(subset), current);
    const result = mechanicalScenario(prepared, candidate);
    const free = subset.length * result.freeOrderShare;
    return {
      segmentKey: segment.key,
      pays: subset.length - free,
      free,
      switches: result.impact.switchedTier,
    };
  });
}
