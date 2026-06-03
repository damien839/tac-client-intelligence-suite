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

/** A raw order parsed from the Shopify CSV. */
export interface OrderRow {
  gross: number; // gross sale / cart value
  shippingPaid: number; // shipping actually paid at checkout (ground truth)
  rawService: string; // service string as it appears in the CSV
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
