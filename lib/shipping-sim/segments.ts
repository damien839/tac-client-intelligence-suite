import { behavioralScenario, bucketOrders, prepareBuckets } from "./recommend";
import {
  BehaviorParams,
  ItemBand,
  Scheme,
  Segment,
  SegmentOutcome,
  TaggedOrder,
  TierConfig,
  ValuePosition,
} from "./types";

function itemBandOf(units: number | undefined): ItemBand {
  if (units === undefined || units < 1) return "unknown";
  if (units === 1) return "single";
  if (units === 2) return "double";
  return "threePlus";
}

/**
 * Position of an order's value vs its CURRENT tier's free threshold.
 * Flat tiers (no threshold) have nothing to build toward, so orders are
 * "wellBelow" — unless the flat fee is 0, where everyone already ships free
 * and the segment reads "atOrAbove". (A flat tier with a positive fee can
 * never be at/above a threshold that does not exist.)
 */
function positionOf(gross: number, config: TierConfig, window: number): ValuePosition {
  if (config.freeThreshold === null) {
    return config.fee === 0 ? "atOrAbove" : "wellBelow";
  }
  if (gross >= config.freeThreshold) return "atOrAbove";
  if (gross >= config.freeThreshold - window) return "withinOneUnit";
  return "wellBelow";
}

function keyOf(order: TaggedOrder, current: Scheme, window: number): string {
  const itemBand = itemBandOf(order.units);
  const position = positionOf(order.gross, current[order.tier]!, window);
  return `${itemBand}|${position}|${order.tier}`;
}

/**
 * Static buying-behaviour segmentation of the order book vs the CURRENT scheme:
 * item-count band (from line-item data; "unknown" without it) x value position vs
 * the order's current tier threshold x chosen tier. `window` is the unit window —
 * the typical unit price when line-item data exists, else the uplift-window slider.
 * Empty segments are omitted; output is sorted by order count (desc), then key.
 */
export function segmentOrders(
  orders: TaggedOrder[],
  current: Scheme,
  window: number
): Segment[] {
  const valid = orders.filter((order) => current[order.tier] !== undefined);
  if (valid.length === 0) return [];
  const totalGross = valid.reduce((sum, order) => sum + order.gross, 0);

  const counts = new Map<string, { orders: number; gross: number; sample: TaggedOrder }>();
  for (const order of valid) {
    const key = keyOf(order, current, window);
    const entry = counts.get(key);
    counts.set(
      key,
      entry
        ? { orders: entry.orders + 1, gross: entry.gross + order.gross, sample: entry.sample }
        : { orders: 1, gross: order.gross, sample: order }
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
 * EV-weighted outcome of each segment under a candidate scheme, evaluated with the
 * same behavioural model as the option itself (`window` overrides the uplift window,
 * matching the option's effective window). Segments partition the analysable orders,
 * and behavioralScenario is additive over buckets, so per-segment outcomes sum
 * exactly to the whole-book scenario.
 */
export function segmentOutcomes(
  orders: TaggedOrder[],
  current: Scheme,
  candidate: Scheme,
  behavior: BehaviorParams,
  window: number
): SegmentOutcome[] {
  const valid = orders.filter((order) => current[order.tier] !== undefined);
  if (valid.length === 0) return [];
  const params: BehaviorParams = { ...behavior, upliftWindow: window };

  const groups = new Map<string, TaggedOrder[]>();
  for (const order of valid) {
    const key = keyOf(order, current, window);
    const group = groups.get(key);
    if (group) {
      group.push(order);
    } else {
      groups.set(key, [order]);
    }
  }

  return segmentOrders(orders, current, window).map((segment): SegmentOutcome => {
    const subset = groups.get(segment.key) ?? [];
    const prepared = prepareBuckets(bucketOrders(subset), current);
    const result = behavioralScenario(prepared, candidate, params);
    // Every order's build/abandon/pay weights sum to 1, so completing = n - lost.
    const completing = subset.length - result.expectedOrdersLost;
    const free = completing * result.freeOrderShare;
    return {
      segmentKey: segment.key,
      pays: completing - free,
      free,
      builds: result.impact.builders,
      switches: result.impact.switchedTier,
      abandons: result.expectedOrdersLost,
    };
  });
}
