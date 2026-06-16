import { tierCost } from "./tiers";
import {
  CanonicalTier,
  CurvePercentiles,
  CurveStats,
  Scheme,
  TaggedOrder,
} from "./types";

const HIST_BAND = 25; // $ width of a histogram band (deep-dive parity, fixed)
const PULL_BAND = 5; // $ width of a threshold-pull band
const PULL_SPAN = 50; // $ each side of the current line the pull zone covers
const LOAD_BAND = 50; // $ width of a shipping-load band
const LOAD_MAX = 400; // ceiling for the load chart (above this, load is negligible)
const PRICE_POINT_CAP = 12;

/**
 * Percentile by linear interpolation between closest ranks on the sorted sample.
 * `sorted` must be ascending and non-empty.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (rank - lo) * (sorted[hi] - sorted[lo]);
}

function percentiles(sorted: number[]): CurvePercentiles {
  return {
    p10: percentile(sorted, 10),
    p25: percentile(sorted, 25),
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

const EMPTY: CurveStats = {
  count: 0,
  mean: 0,
  median: 0,
  stdev: 0,
  min: 0,
  max: 0,
  percentiles: { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, p95: 0, p99: 0 },
  skewPct: 0,
  histogram: [],
  pricePoints: [],
  pullZone: null,
  shippingLoad: [],
  freeAov: 0,
  paidAov: 0,
  freeN: 0,
  paidN: 0,
  shipRevPctGmv: 0,
};

/** $25-band histogram. The final band is open-ended at the p99-rounded ceiling. */
function histogram(sorted: number[], ceiling: number): CurveStats["histogram"] {
  const bands: CurveStats["histogram"] = [];
  for (let lo = 0; lo < ceiling; lo += HIST_BAND) {
    const hi = lo + HIST_BAND;
    // Upper edge is exclusive so a value exactly on a boundary lands in the upper band.
    const n = sorted.filter((g) => g >= lo && g < hi).length;
    bands.push({ lo, hi, n });
  }
  const tailN = sorted.filter((g) => g >= ceiling).length;
  bands.push({ lo: ceiling, hi: null, n: tailN });
  return bands;
}

/** Exact-subtotal frequency (rounded to the cent), most common first, capped. */
function pricePoints(grossValues: number[]): CurveStats["pricePoints"] {
  const counts = new Map<number, number>();
  for (const g of grossValues) {
    const v = Math.round(g * 100) / 100;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([value, n]) => ({ value, n }))
    .sort((a, b) => b.n - a.n || a.value - b.value)
    .slice(0, PRICE_POINT_CAP);
}

/** $5 bands across the dominant tier's current free line ±$50, or null when flat. */
function pullZone(
  grossValues: number[],
  current: Scheme,
  dominantTier: CanonicalTier | null
): CurveStats["pullZone"] {
  if (dominantTier === null) return null;
  const threshold = current[dominantTier]?.freeThreshold;
  if (threshold === null || threshold === undefined) return null;
  const start = Math.max(0, threshold - PULL_SPAN);
  const end = threshold + PULL_SPAN;
  const bands: { lo: number; n: number }[] = [];
  for (let lo = start; lo < end; lo += PULL_BAND) {
    const n = grossValues.filter((g) => g >= lo && g < lo + PULL_BAND).length;
    bands.push({ lo, n });
  }
  return { threshold, bands };
}

/**
 * Dominant tier's current fee as a % of band midpoint. A band whose midpoint sits
 * at/above that tier's free line reads 0% (those orders already ship free).
 */
function shippingLoad(
  grossValues: number[],
  current: Scheme,
  dominantTier: CanonicalTier | null
): CurveStats["shippingLoad"] {
  if (dominantTier === null) return [];
  const config = current[dominantTier];
  if (!config) return [];
  const out: CurveStats["shippingLoad"] = [];
  for (let lo = 0; lo < LOAD_MAX; lo += LOAD_BAND) {
    const hi = lo + LOAD_BAND;
    const n = grossValues.filter((g) => g >= lo && g < hi).length;
    if (n === 0) continue;
    const mid = lo + LOAD_BAND / 2;
    const fee = tierCost(config, mid);
    out.push({ lo, hi, loadPct: mid > 0 ? (fee / mid) * 100 : 0, n });
  }
  return out;
}

/**
 * Descriptive anatomy of the order-value curve under the current scheme.
 * Pure — `orders` is the valid set (current scheme defines each order's tier).
 */
export function curveStats(
  orders: TaggedOrder[],
  current: Scheme,
  dominantTier: CanonicalTier | null
): CurveStats {
  if (orders.length === 0) return EMPTY;

  const grossValues = orders.map((o) => o.gross);
  const sorted = [...grossValues].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((s, g) => s + g, 0);
  const mean = sum / count;
  const variance = sorted.reduce((s, g) => s + (g - mean) ** 2, 0) / count;
  const pct = percentiles(sorted);
  const median = pct.p50;

  // Open-ended final band at the p99 value rounded up to the next $25 (keeps the
  // long tail from stretching the axis); never below one band.
  const ceiling = Math.max(HIST_BAND, Math.ceil(pct.p99 / HIST_BAND) * HIST_BAND);

  let freeSum = 0;
  let freeN = 0;
  let paidSum = 0;
  let paidN = 0;
  let feeSum = 0;
  for (const o of orders) {
    const config = current[o.tier];
    const fee = config ? tierCost(config, o.gross) : 0;
    feeSum += fee;
    if (fee === 0) {
      freeSum += o.gross;
      freeN += 1;
    } else {
      paidSum += o.gross;
      paidN += 1;
    }
  }

  return {
    count,
    mean,
    median,
    stdev: Math.sqrt(variance),
    min: sorted[0],
    max: sorted[count - 1],
    percentiles: pct,
    skewPct: median > 0 ? (mean / median - 1) * 100 : 0,
    histogram: histogram(sorted, ceiling),
    pricePoints: pricePoints(grossValues),
    pullZone: pullZone(grossValues, current, dominantTier),
    shippingLoad: shippingLoad(grossValues, current, dominantTier),
    freeAov: freeN > 0 ? freeSum / freeN : 0,
    paidAov: paidN > 0 ? paidSum / paidN : 0,
    freeN,
    paidN,
    shipRevPctGmv: sum > 0 ? (feeSum / sum) * 100 : 0,
  };
}
