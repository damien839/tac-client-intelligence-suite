export type CanonicalTier = "standard" | "express" | "nextday" | "sameday";

export const CANONICAL_TIERS: readonly CanonicalTier[] = [
  "standard",
  "express",
  "nextday",
  "sameday",
];

export const TIER_LABELS: Record<CanonicalTier, string> = {
  standard: "Standard",
  express: "Express",
  nextday: "Next Day",
  sameday: "Same Day",
};

/** Evidence that a full Shopify export carried usable line-item data. */
export interface UnitStats {
  ordersWithUnits: number; // orders carrying line-item data
}

/** A raw order parsed from the Shopify CSV. */
export interface OrderRow {
  gross: number; // gross sale / cart value
  shippingPaid: number; // shipping actually paid at checkout (ground truth)
  rawService: string; // service string as it appears in the CSV
  units?: number; // total line-item quantity (full Shopify export only)
}

/** An order after its rawService has been mapped to a canonical tier. */
export interface TaggedOrder extends OrderRow {
  tier: CanonicalTier;
}

/** Per-tier pricing + cost configuration. */
export interface TierConfig {
  tier: CanonicalTier;
  fee: number; // charged when below threshold
  freeThreshold: number | null; // free at/above this cart value; null = flat (fee always applies)
  avgCost: number; // carrier cost per order for this tier
}

/** A pricing scheme — only the tiers a merchant actually uses are present. */
export type Scheme = Partial<Record<CanonicalTier, TierConfig>>;

export interface Reconciliation {
  actualShippingPaid: number; // Σ shippingPaid from the CSV
  modelledCurrentRevenue: number; // current scheme modelled revenue
  variancePct: number; // |modelled - actual| / actual  (0..1)
}

export interface CurvePercentiles {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
}

/** Descriptive anatomy of the order-value curve under the current scheme. */
export interface CurveStats {
  count: number;
  mean: number;
  median: number;
  stdev: number;
  min: number;
  max: number;
  percentiles: CurvePercentiles;
  skewPct: number; // mean/median - 1, as a percentage (0 when median is 0)
  /** $25 bands; the final band is open-ended (hi === null). */
  histogram: { lo: number; hi: number | null; n: number }[];
  /** Most common exact subtotals (rounded to the cent), count-desc, capped at 12. */
  pricePoints: { value: number; n: number }[];
  /**
   * $5 bands spanning the dominant tier's current free-ship line ±$50, for the
   * threshold-pull visual. Null when the dominant tier is flat (no free line to sit under).
   */
  pullZone: { threshold: number; bands: { lo: number; n: number }[] } | null;
  /** Dominant tier's current fee as a % of band midpoint; bands at/above a free line read 0%. */
  shippingLoad: { lo: number; hi: number; loadPct: number; n: number }[];
  freeAov: number; // AOV of orders that ship free under the current scheme
  paidAov: number; // AOV of orders that pay shipping under the current scheme
  freeN: number;
  paidN: number;
  shipRevPctGmv: number; // Σ current fee / Σ gross (0 when GMV is 0)
}

/** Orders grouped by identical treatment under the mechanical model. */
export interface OrderBucket {
  tier: CanonicalTier;
  gross: number;
  count: number;
}

/**
 * Mechanical outcome of one candidate scheme over the uploaded order book.
 * The same orders, in the same quantity — only the tier each one lands on (via
 * revealed-preference), the fee it pays, and the carrier cost it incurs can move.
 */
export interface MechanicalResult {
  shippingRevenue: number; // Σ fee paid under the candidate
  carrierSpend: number; // Σ carrier cost of the landed tier
  netShippingProfit: number; // shippingRevenue - carrierSpend
  orderCount: number; // analysable orders the result covers
  freeOrderShare: number; // 0..1 of orders that ship free
  recoveryRate: number; // shippingRevenue / carrierSpend (0 when spend is 0)
  /** Order volume per landed tier. */
  volumeByTier: Record<CanonicalTier, number>;
  /** Carrier spend per landed tier. */
  carrierSpendByTier: Record<CanonicalTier, number>;
  /** How the candidate moves orders vs the current scheme. */
  impact: {
    newlyPaying: number; // paid $0 under current, pays >$0 under the candidate
    newlyFree: number; // paid >$0 under current, ships $0 under the candidate
    switchedTier: number; // lands on a different tier than the customer chose
  };
}

/** Mechanical metrics for one candidate scheme, expressed against the current scheme. */
export interface SchemeEvaluation {
  shippingRevenue: number;
  carrierSpend: number;
  netShippingProfit: number;
  shippingRevenueDelta: number; // vs current
  carrierSpendDelta: number; // vs current
  netShippingProfitDelta: number; // shippingRevenueDelta - carrierSpendDelta
  recoveryRate: number; // under the candidate
  recoveryRateCurrent: number; // under the current scheme — the "current → proposed" pair
  freeOrderShare: number;
  orderCount: number; // analysable orders the evaluation covers
  /** Order volume per landed tier. */
  volumeByTier: Record<CanonicalTier, number>;
  /** Carrier spend per landed tier. */
  carrierSpendByTier: Record<CanonicalTier, number>;
  impact: MechanicalResult["impact"];
}

/** One row of the candidate comparison grid, before evaluation. */
export interface CandidateScheme {
  id: string; // "current" | "threshold-250" | "all-free" | "no-free" | "competitor"
  label: string;
  shortLabel: string;
  scheme: Scheme;
  /** Tiers whose fee or free threshold differ from the current scheme. */
  changedTiers: CanonicalTier[];
  /** The candidate is the current scheme (changedTiers is empty). */
  isCurrent: boolean;
}

export interface ThresholdCurvePoint {
  threshold: number;
  netShippingProfitDelta: number; // Δ net shipping P&L vs current, mechanical
}

/** Buying-behaviour band by line-item count; "unknown" when no line-item data. */
export type ItemBand = "single" | "double" | "threePlus" | "unknown";

/**
 * Where an order's value sits vs its CURRENT tier's free threshold:
 * at/above it, just below it (within the report's descriptive band), or well below it.
 * Convention for flat tiers (no threshold): there is nothing to build toward, so
 * orders are "wellBelow" — unless the flat fee is 0 (everyone already ships free),
 * which reports "atOrAbove".
 */
export type ValuePosition = "wellBelow" | "justBelow" | "atOrAbove";

/** One buying-behaviour segment of the order book vs the current scheme. */
export interface Segment {
  key: string; // e.g. "single|justBelow|standard"
  itemBand: ItemBand;
  position: ValuePosition;
  tier: CanonicalTier;
  orders: number;
  valueShare: number; // share of total gross across analysable orders, 0..1
}

/** Order outcomes for one segment under a candidate scheme. */
export interface SegmentOutcome {
  segmentKey: string;
  pays: number;
  free: number;
  switches: number;
}
