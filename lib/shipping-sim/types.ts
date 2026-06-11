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

/** Statistics derived from line-item data in a full Shopify export. */
export interface UnitStats {
  typicalUnitPrice: number; // quantity-weighted median line-item price
  ordersWithUnits: number; // orders carrying line-item data
  unitShare: { single: number; double: number; threePlus: number }; // share of orders by item count, 0..1
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

export interface ScenarioResult {
  shippingRevenue: number;
  carrierSpend: number;
  ordersByTier: Record<CanonicalTier, number>;
  netShippingProfit: number; // shippingRevenue - carrierSpend
}

export interface Reconciliation {
  actualShippingPaid: number; // Σ shippingPaid from the CSV
  modelledCurrentRevenue: number; // current scheme modelled revenue
  variancePct: number; // |modelled - actual| / actual  (0..1)
}

export interface CogsContext {
  cogsPercent: number;
  grossProductMargin: number; // Σ gross * (1 - cogsPercent); identical both scenarios
}

export interface Benchmark {
  current: ScenarioResult;
  proposed: ScenarioResult;
  shippingRevenueDelta: number;
  carrierSpendDelta: number;
  netProfitDelta: number; // shippingRevenueDelta - carrierSpendDelta
  reconciliation: Reconciliation;
  cogsContext?: CogsContext;
}

export interface TierEconomics {
  tier: CanonicalTier;
  count: number;
  feeRevenue: number;
  carrierCost: number;
  net: number; // feeRevenue - carrierCost
  recoveryRate: number; // feeRevenue / carrierCost (0 when carrierCost is 0)
}

export interface OrderMovement {
  gross: number;
  chosenTier: CanonicalTier;
  chosenFee: number;
  landedTier: CanonicalTier;
  landedFee: number;
  moved: boolean;
  netDelta: number; // (landedFee - landedCarrier) - (chosenFee - chosenCarrier)
}

export interface ThresholdSweepPoint {
  threshold: number;
  netShippingProfit: number;
}

export interface Analysis {
  benchmark: Benchmark;
  recoveryCurrent: number;
  recoveryProposed: number;
  subsidyCurrent: number;
  subsidyProposed: number;
  freeOrdersCurrent: number;
  freeOrdersProposed: number;
  tierEconomicsCurrent: TierEconomics[];
  tierEconomicsProposed: TierEconomics[];
  movement: OrderMovement[];
  movedCount: number;
  thresholdSweep: ThresholdSweepPoint[];
  optimalThreshold: number;
  optimalNet: number;
  netDeltaPerOrder: number;
}

/** Tunable behavioural assumptions driving the recommendation engine. */
export interface BehaviorParams {
  cogsPercent: number; // 0..1 — required to value product-margin effects
  upliftRate: number; // 0..1 — share of in-window orders that build baskets to the threshold
  upliftWindow: number; // $ — "in window" = within this much below the landed tier's threshold
  abandonRate: number; // 0..1 — share abandoning *per $10 of shipping-cost increase*, capped at 100% (e.g. 0.1 → 10% abandon per $10 increase, so a $30 increase → 30% abandon)
}

/** Orders grouped by identical behaviour under the model. */
export interface OrderBucket {
  tier: CanonicalTier;
  gross: number;
  count: number;
}

/** Expected-value outcome of one candidate scheme under the behavioural model. */
export interface BehavioralResult {
  shippingRevenue: number;
  carrierSpend: number;
  netShippingProfit: number; // shippingRevenue - carrierSpend
  upliftMarginGain: number; // product margin added by basket-building
  abandonMarginLoss: number; // product margin lost to abandonment
  expectedOrdersLost: number; // abandonment, in (fractional) orders
  freeOrderShare: number; // 0..1 of completing orders that ship free
  recoveryRate: number; // shippingRevenue / carrierSpend (0 when spend is 0)
  /** EV-weighted completing-order volume per landed tier. */
  volumeByTier: Record<CanonicalTier, number>;
  /** EV-weighted carrier spend per landed tier. */
  carrierSpendByTier: Record<CanonicalTier, number>;
  /**
   * EV-weighted order counts describing how the candidate moves orders vs current.
   * Builders are NOT included in newlyFree — each count captures its own mechanism
   * (builders are in-window orders that build baskets; newlyFree are completing payers
   * whose fee dropped to zero).
   */
  impact: {
    newlyPaying: number; // paid $0 under current, pays >$0 under candidate (completing payers only)
    newlyFree: number; // paid >$0 under current, ships $0 under candidate (completing payers only — builders counted separately)
    builders: number; // basket-building weight
    switchedTier: number; // completing weight landing on a different tier than chosen
  };
}

export type RecommendationId = "profit-first" | "threshold-fee" | "basket-builder";

/** Behavioural metrics for one arbitrary candidate scheme (used for the Custom comparison column). */
export interface SchemeEvaluation {
  contributionDelta: number;
  netShippingProfitDelta: number;
  shippingRevenue: number;
  carrierSpend: number;
  netShippingProfit: number;
  upliftMarginGain: number;
  abandonMarginLoss: number;
  expectedOrdersLost: number;
  freeOrderShare: number;
  recoveryRate: number;
  orderCount: number; // analysable orders the evaluation covers
  /** EV-weighted completing-order volume per landed tier. */
  volumeByTier: Record<CanonicalTier, number>;
  /** EV-weighted carrier spend per landed tier. */
  carrierSpendByTier: Record<CanonicalTier, number>;
  impact: BehavioralResult["impact"];
}

export interface ThresholdCurvePoint {
  threshold: number;
  contributionNoUplift: number; // Δ total contribution vs current, basket-building off
  contributionWithUplift: number; // same, basket-building per the caller's params
}

/** One recommendation card. */
export interface RecommendedScheme {
  id: RecommendationId;
  label: string;
  /** The tier this recommendation re-prices; fee/threshold refer to this tier. */
  tier: CanonicalTier;
  threshold: number | null; // recommended free-over for `tier` (null = flat)
  fee: number; // fee for `tier` (= current fee for profit-first / basket-builder)
  contributionDelta: number; // objective: shipping P&L delta + margin effects, vs current
  netShippingProfitDelta: number;
  upliftMarginGain: number; // 0 for profit-first / threshold-fee
  abandonMarginLoss: number;
  freeOrderShare: number;
  recoveryRate: number;
  expectedOrdersLost: number;
  unconstrained: boolean; // degeneracy guard tripped — see recommend.ts
  /** Optimum sits at the sweep limit — the true optimum may lie beyond the tested range. */
  capPinned: boolean;
}
