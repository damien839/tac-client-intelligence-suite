/**
 * TAC Client Intelligence Suite — Core Financial Calculations
 * 
 * All functions are pure (no side effects, no React dependencies).
 * Every formula is documented inline per the financial audit findings.
 * 
 * KEY AUDIT CONSTRAINT: 
 * - Profit includes shipping collected as revenue
 * - Only COGS% is exposed; gross margin is derived (1 - COGS%)
 * - All inputs are per-client, nothing hardcoded
 * - Scenario engine computes from first principles using order data
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface UnitEconomics {
  cogsPercent: number;          // e.g. 0.26 for 26%
  shippingCostPerOrder: number; // Fulfilment + shipping cost ($)
  txFeePercent: number;         // Payment processor variable fee (e.g. 0.035)
  txFeeFixed: number;           // Payment processor fixed fee (e.g. $0.30)
  shippingChargeToCustomer: number; // What customer pays when below threshold ($)
  returnRate: number;           // e.g. 0.15 for 15%
  returnShippingCost: number;   // Cost to process a return shipment ($)
}

export interface ThresholdConfig {
  currentThreshold: number;     // Current free shipping threshold ($)
  proposedThreshold: number;    // Proposed threshold ($)
  flatFeeAlternative: number;   // Flat fee for sub-threshold orders ($), 0 = full rate
}

export interface ElasticityInputs {
  enabled: boolean;
  cartAbandonmentRate: number;      // % of sub-threshold orders lost (e.g. 0.10)
  thresholdSeekingUplift: number;   // % of near-threshold orders that add items (e.g. 0.15)
  seekerAovUplift: number;          // Average extra spend by threshold seekers ($)
}

export interface OrderRow {
  orderId: string;
  createdAt: string;
  totalPrice: number;           // Order revenue (AOV)
  shippingCollected: number;    // Shipping paid by customer
  lineItemQty: number;          // Units per transaction
  carrierService: string;       // e.g. "Express", "Standard"
  netPayment: number;
}

export interface AovBucket {
  rangeLabel: string;           // e.g. "$100–$105"
  rangeLow: number;
  rangeHigh: number;
  orderCount: number;
  avgAov: number;
  avgShippingCollected: number;
  avgUpt: number;
  totalRevenue: number;
  totalShippingCollected: number;
  carrierSplit: Record<string, number>; // service level → count
}

export interface ScenarioResult {
  label: string;
  threshold: number;
  totalOrders: number;
  ordersPayingShipping: number;
  ordersFreeShipping: number;
  totalRevenue: number;
  totalShippingCollected: number;
  totalShippingCost: number;
  totalTxFees: number;
  totalCogs: number;
  totalReturnCost: number;
  totalProfit: number;
  avgProfitPerOrder: number;
  profitMarginPercent: number;
  carrierSplit: Record<string, { paying: number; free: number }>;
}

export interface RetentionInputs {
  monthlyOrderVolume: number;
  percentNewCustomers: number;      // e.g. 0.65
  percentRepeatCustomers: number;   // e.g. 0.35
  aovNew: number;
  aovRepeat: number;
  cacNew: number;
  grossMarginPercent: number;       // This is derived from (1 - COGS%) or entered separately for Module 3
  fixedCostsPerMonth: number;
  proposedRepeatRateImprovement: number; // e.g. 0.05 for +5%
  tacMonthlyFee: number;           // Optional: TAC engagement fee
}

export interface RetentionResult {
  currentEbit: number;
  proposedEbit: number;
  ebitUplift: number;
  ebitUpliftPercent: number;
  currentBlendedCac: number;
  proposedBlendedCac: number;
  breakEvenMonths: number | null;   // null if TAC fee not entered
  monthlyProjection: Array<{
    month: number;
    currentEbit: number;
    proposedEbit: number;
    cumulativeUplift: number;
  }>;
}

// ─── Derived Values ─────────────────────────────────────────────────

/**
 * Gross margin is derived from COGS%.
 * Audit constraint: only expose COGS%, derive gross margin.
 */
export function grossMarginFromCogs(cogsPercent: number): number {
  return 1 - cogsPercent;
}

// ─── Module 1: Shipping Strategy ────────────────────────────────────

/**
 * Profit per order — CORRECTED formula from audit:
 * 
 * Profit = (Revenue × (1 - COGS%)) + Shipping Collected 
 *          − Shipping Cost − (Revenue × Tx Fee%) − Tx Fixed Fee
 * 
 * Then adjusted for returns:
 * Adjusted Profit = Profit × (1 - Return Rate) − (Return Rate × Return Shipping Cost)
 * 
 * This means: for each order, (1 - returnRate) fraction survives as profit,
 * and returnRate fraction incurs the return shipping cost.
 */
export function profitPerOrder(
  revenue: number,
  shippingCollected: number,
  economics: UnitEconomics
): number {
  const grossProfit = revenue * grossMarginFromCogs(economics.cogsPercent);
  const txFees = revenue * economics.txFeePercent + economics.txFeeFixed;
  
  // Base profit includes shipping collected as revenue (audit fix #1)
  const baseProfit = grossProfit + shippingCollected - economics.shippingCostPerOrder - txFees;
  
  // Adjust for returns: some fraction of orders are returned
  const adjustedProfit = baseProfit * (1 - economics.returnRate) 
                       - (economics.returnRate * economics.returnShippingCost);
  
  return adjustedProfit;
}

/**
 * Bucket orders into $5 AOV increments for distribution analysis.
 */
export function bucketOrders(orders: OrderRow[], bucketSize: number = 5): AovBucket[] {
  if (orders.length === 0) return [];
  
  const maxAov = Math.ceil(Math.max(...orders.map(o => o.totalPrice)) / bucketSize) * bucketSize;
  const minAov = Math.floor(Math.min(...orders.map(o => o.totalPrice)) / bucketSize) * bucketSize;
  
  const buckets: Map<number, OrderRow[]> = new Map();
  
  for (let low = minAov; low < maxAov; low += bucketSize) {
    buckets.set(low, []);
  }
  
  for (const order of orders) {
    const low = Math.floor(order.totalPrice / bucketSize) * bucketSize;
    const existing = buckets.get(low) || [];
    existing.push(order);
    buckets.set(low, existing);
  }
  
  const result: AovBucket[] = [];
  
  for (const [low, bucketOrders] of Array.from(buckets.entries()).sort((a, b) => a[0] - b[0])) {
    if (bucketOrders.length === 0) continue;
    
    const high = low + bucketSize;
    const count = bucketOrders.length;
    const totalRevenue = bucketOrders.reduce((s, o) => s + o.totalPrice, 0);
    const totalShipping = bucketOrders.reduce((s, o) => s + o.shippingCollected, 0);
    const totalUpt = bucketOrders.reduce((s, o) => s + o.lineItemQty, 0);
    
    // Carrier service level split
    const carrierSplit: Record<string, number> = {};
    for (const o of bucketOrders) {
      const service = o.carrierService || "Unknown";
      carrierSplit[service] = (carrierSplit[service] || 0) + 1;
    }
    
    result.push({
      rangeLabel: `$${low}–$${high}`,
      rangeLow: low,
      rangeHigh: high,
      orderCount: count,
      avgAov: totalRevenue / count,
      avgShippingCollected: totalShipping / count,
      avgUpt: totalUpt / count,
      totalRevenue,
      totalShippingCollected: totalShipping,
      carrierSplit,
    });
  }
  
  return result;
}

/**
 * Compute a full scenario for a given threshold.
 * 
 * For each order:
 * - If order total >= threshold → free shipping (shippingCollected = 0)
 * - If order total < threshold → customer pays shipping charge
 * 
 * With elasticity (optional):
 * - Sub-threshold orders have a cartAbandonmentRate chance of being lost entirely
 * - Orders within seekerAovUplift of threshold have a thresholdSeekingUplift chance
 *   of increasing their AOV to meet the threshold
 */
export function computeScenario(
  orders: OrderRow[],
  threshold: number,
  economics: UnitEconomics,
  elasticity?: ElasticityInputs,
  flatFee?: number
): ScenarioResult {
  let totalRevenue = 0;
  let totalShippingCollected = 0;
  let totalShippingCost = 0;
  let totalTxFees = 0;
  let totalCogs = 0;
  let totalReturnCost = 0;
  let totalProfit = 0;
  let ordersPayingShipping = 0;
  let ordersFreeShipping = 0;
  let effectiveOrderCount = 0;
  
  const carrierSplit: Record<string, { paying: number; free: number }> = {};
  
  for (const order of orders) {
    let revenue = order.totalPrice;
    let shippingCollected = 0;
    let includeOrder = true;
    
    // Threshold = 0 means remove threshold (everyone gets free shipping)
    // Threshold = Infinity means everyone pays
    const isBelowThreshold = threshold > 0 && revenue < threshold;
    
    if (isBelowThreshold) {
      // Check elasticity: might this order be lost?
      if (elasticity?.enabled) {
        // Orders within $50 of threshold might add items (threshold-seeking)
        const distanceToThreshold = threshold - revenue;
        if (distanceToThreshold <= elasticity.seekerAovUplift && distanceToThreshold > 0) {
          // Some fraction seek the threshold
          if (Math.random() < elasticity.thresholdSeekingUplift) {
            // This order upgrades to meet threshold
            revenue = threshold;
            shippingCollected = 0; // Now qualifies for free shipping
            ordersFreeShipping++;
          } else if (Math.random() < elasticity.cartAbandonmentRate) {
            // Abandoned
            includeOrder = false;
          } else {
            // Stays as-is, pays shipping
            shippingCollected = flatFee && flatFee > 0 ? flatFee : economics.shippingChargeToCustomer;
            ordersPayingShipping++;
          }
        } else if (Math.random() < elasticity.cartAbandonmentRate) {
          // Not near threshold → might abandon
          includeOrder = false;
        } else {
          shippingCollected = flatFee && flatFee > 0 ? flatFee : economics.shippingChargeToCustomer;
          ordersPayingShipping++;
        }
      } else {
        // No elasticity: deterministic
        shippingCollected = flatFee && flatFee > 0 ? flatFee : economics.shippingChargeToCustomer;
        ordersPayingShipping++;
      }
    } else {
      // Above threshold or threshold is 0 (free for all)
      shippingCollected = 0;
      ordersFreeShipping++;
    }
    
    if (!includeOrder) continue;
    
    effectiveOrderCount++;
    const orderProfit = profitPerOrder(revenue, shippingCollected, economics);
    
    totalRevenue += revenue;
    totalShippingCollected += shippingCollected;
    totalShippingCost += economics.shippingCostPerOrder;
    totalTxFees += revenue * economics.txFeePercent + economics.txFeeFixed;
    totalCogs += revenue * economics.cogsPercent;
    totalReturnCost += economics.returnRate * economics.returnShippingCost;
    totalProfit += orderProfit;
    
    // Track carrier split
    const service = order.carrierService || "Unknown";
    if (!carrierSplit[service]) {
      carrierSplit[service] = { paying: 0, free: 0 };
    }
    if (isBelowThreshold && shippingCollected > 0) {
      carrierSplit[service].paying++;
    } else {
      carrierSplit[service].free++;
    }
  }
  
  return {
    label: threshold === 0 ? "No Threshold" : `$${threshold} Threshold`,
    threshold,
    totalOrders: effectiveOrderCount,
    ordersPayingShipping,
    ordersFreeShipping,
    totalRevenue,
    totalShippingCollected,
    totalShippingCost,
    totalTxFees,
    totalCogs,
    totalReturnCost,
    totalProfit,
    avgProfitPerOrder: effectiveOrderCount > 0 ? totalProfit / effectiveOrderCount : 0,
    profitMarginPercent: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
    carrierSplit,
  };
}

/**
 * Compute deterministic scenario (no randomness) for consistent UI.
 * Instead of random sampling for elasticity, applies rates as proportions.
 */
export function computeScenarioDeterministic(
  orders: OrderRow[],
  threshold: number,
  economics: UnitEconomics,
  elasticity?: ElasticityInputs,
  flatFee?: number
): ScenarioResult {
  let totalRevenue = 0;
  let totalShippingCollected = 0;
  let totalShippingCost = 0;
  let totalTxFees = 0;
  let totalCogs = 0;
  let totalReturnCost = 0;
  let totalProfit = 0;
  let ordersPayingShipping = 0;
  let ordersFreeShipping = 0;
  let effectiveOrderCount = 0;
  
  const carrierSplit: Record<string, { paying: number; free: number }> = {};
  
  for (const order of orders) {
    const revenue = order.totalPrice;
    const isBelowThreshold = threshold > 0 && revenue < threshold;
    
    // Weight represents the effective "fraction" of this order that survives
    let weight = 1;
    const effectiveRevenue = revenue;
    let shippingCollected = 0;
    
    if (isBelowThreshold) {
      if (elasticity?.enabled) {
        const distanceToThreshold = threshold - revenue;
        
        if (distanceToThreshold <= (elasticity.seekerAovUplift || 50) && distanceToThreshold > 0) {
          // Near threshold: split into seekers, abandoners, and stayers
          const seekerFraction = elasticity.thresholdSeekingUplift;
          const abandonFraction = (1 - seekerFraction) * elasticity.cartAbandonmentRate;
          const stayFraction = 1 - seekerFraction - abandonFraction;
          
          // Seekers: upgrade AOV to threshold, get free shipping
          const seekerRevenue = threshold;
          const seekerShipping = 0;
          const seekerProfit = profitPerOrder(seekerRevenue, seekerShipping, economics) * seekerFraction;
          
          // Stayers: keep original AOV, pay shipping
          const stayShipping = flatFee && flatFee > 0 ? flatFee : economics.shippingChargeToCustomer;
          const stayProfit = profitPerOrder(revenue, stayShipping, economics) * stayFraction;
          
          // Composite
          const compositeProfit = seekerProfit + stayProfit;
          const compositeRevenue = seekerRevenue * seekerFraction + revenue * stayFraction;
          const compositeShipping = stayShipping * stayFraction;
          const compositeWeight = seekerFraction + stayFraction; // abandoners are lost
          
          effectiveOrderCount += compositeWeight;
          totalRevenue += compositeRevenue;
          totalShippingCollected += compositeShipping;
          totalShippingCost += economics.shippingCostPerOrder * compositeWeight;
          totalTxFees += (compositeRevenue * economics.txFeePercent + economics.txFeeFixed * compositeWeight);
          totalCogs += compositeRevenue * economics.cogsPercent;
          totalReturnCost += economics.returnRate * economics.returnShippingCost * compositeWeight;
          totalProfit += compositeProfit;
          ordersPayingShipping += stayFraction;
          ordersFreeShipping += seekerFraction;
          
          const service = order.carrierService || "Unknown";
          if (!carrierSplit[service]) carrierSplit[service] = { paying: 0, free: 0 };
          carrierSplit[service].paying += stayFraction;
          carrierSplit[service].free += seekerFraction;
          continue;
        } else {
          // Far from threshold: some abandon, rest pay shipping
          weight = 1 - elasticity.cartAbandonmentRate;
          shippingCollected = flatFee && flatFee > 0 ? flatFee : economics.shippingChargeToCustomer;
        }
      } else {
        shippingCollected = flatFee && flatFee > 0 ? flatFee : economics.shippingChargeToCustomer;
      }
      ordersPayingShipping += weight;
    } else {
      shippingCollected = 0;
      ordersFreeShipping += weight;
    }
    
    effectiveOrderCount += weight;
    const orderProfit = profitPerOrder(effectiveRevenue, shippingCollected, economics) * weight;
    totalRevenue += effectiveRevenue * weight;
    totalShippingCollected += shippingCollected * weight;
    totalShippingCost += economics.shippingCostPerOrder * weight;
    totalTxFees += (effectiveRevenue * economics.txFeePercent + economics.txFeeFixed) * weight;
    totalCogs += effectiveRevenue * economics.cogsPercent * weight;
    totalReturnCost += economics.returnRate * economics.returnShippingCost * weight;
    totalProfit += orderProfit;
    
    const service = order.carrierService || "Unknown";
    if (!carrierSplit[service]) carrierSplit[service] = { paying: 0, free: 0 };
    if (isBelowThreshold) {
      carrierSplit[service].paying += weight;
    } else {
      carrierSplit[service].free += weight;
    }
  }
  
  return {
    label: threshold === 0 ? "No Threshold" : `$${threshold} Threshold`,
    threshold,
    totalOrders: Math.round(effectiveOrderCount),
    ordersPayingShipping: Math.round(ordersPayingShipping),
    ordersFreeShipping: Math.round(ordersFreeShipping),
    totalRevenue,
    totalShippingCollected,
    totalShippingCost,
    totalTxFees,
    totalCogs,
    totalReturnCost,
    totalProfit,
    avgProfitPerOrder: effectiveOrderCount > 0 ? totalProfit / effectiveOrderCount : 0,
    profitMarginPercent: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
    carrierSplit,
  };
}

/**
 * Find the optimal threshold by testing increments.
 * Returns the threshold that maximises total profit.
 */
export function findOptimalThreshold(
  orders: OrderRow[],
  economics: UnitEconomics,
  elasticity?: ElasticityInputs,
  flatFee?: number,
  step: number = 5,
  min: number = 0,
  max: number = 500
): { threshold: number; profit: number } {
  let bestThreshold = 0;
  let bestProfit = -Infinity;
  
  for (let t = min; t <= max; t += step) {
    const result = computeScenarioDeterministic(orders, t, economics, elasticity, flatFee);
    if (result.totalProfit > bestProfit) {
      bestProfit = result.totalProfit;
      bestThreshold = t;
    }
  }
  
  return { threshold: bestThreshold, profit: bestProfit };
}

// ─── Module 3: Retention / EBIT Model ───────────────────────────────

/**
 * EBIT = Revenue × Gross Margin − Total CAC − Fixed Costs
 * 
 * When repeat rate increases:
 * - More repeat customers (lower CAC, often higher AOV)
 * - Fewer new customers needed (lower blended CAC)
 * - Net effect: more contribution margin per dollar of revenue
 */
export function computeRetention(inputs: RetentionInputs): RetentionResult {
  const {
    monthlyOrderVolume,
    percentNewCustomers,
    percentRepeatCustomers,
    aovNew,
    aovRepeat,
    cacNew,
    grossMarginPercent,
    fixedCostsPerMonth,
    proposedRepeatRateImprovement,
    tacMonthlyFee,
  } = inputs;
  
  // Current state
  const currentNewOrders = monthlyOrderVolume * percentNewCustomers;
  const currentRepeatOrders = monthlyOrderVolume * percentRepeatCustomers;
  const currentRevenue = currentNewOrders * aovNew + currentRepeatOrders * aovRepeat;
  const currentGrossProfit = currentRevenue * grossMarginPercent;
  // Repeat customers have near-zero acquisition cost (only retention spend)
  const currentTotalCac = currentNewOrders * cacNew;
  const currentBlendedCac = currentTotalCac / monthlyOrderVolume;
  const currentEbit = currentGrossProfit - currentTotalCac - fixedCostsPerMonth;
  
  // Proposed state: shift X% from new to repeat
  const proposedRepeatPercent = Math.min(percentRepeatCustomers + proposedRepeatRateImprovement, 0.99);
  const proposedNewPercent = 1 - proposedRepeatPercent;
  const proposedNewOrders = monthlyOrderVolume * proposedNewPercent;
  const proposedRepeatOrders = monthlyOrderVolume * proposedRepeatPercent;
  const proposedRevenue = proposedNewOrders * aovNew + proposedRepeatOrders * aovRepeat;
  const proposedGrossProfit = proposedRevenue * grossMarginPercent;
  const proposedTotalCac = proposedNewOrders * cacNew;
  const proposedBlendedCac = proposedTotalCac / monthlyOrderVolume;
  const proposedEbit = proposedGrossProfit - proposedTotalCac - fixedCostsPerMonth;
  
  const ebitUplift = proposedEbit - currentEbit;
  const ebitUpliftPercent = currentEbit !== 0 ? (ebitUplift / Math.abs(currentEbit)) * 100 : 0;
  
  // Break-even on TAC fee
  let breakEvenMonths: number | null = null;
  if (tacMonthlyFee > 0 && ebitUplift > 0) {
    // How many months of uplift to cover TAC fee
    breakEvenMonths = Math.ceil(tacMonthlyFee / ebitUplift);
  }
  
  // 12-month projection
  const monthlyProjection = [];
  let cumulativeUplift = 0;
  for (let m = 1; m <= 12; m++) {
    cumulativeUplift += ebitUplift;
    monthlyProjection.push({
      month: m,
      currentEbit: currentEbit * m,
      proposedEbit: proposedEbit * m,
      cumulativeUplift,
    });
  }
  
  return {
    currentEbit,
    proposedEbit,
    ebitUplift,
    ebitUpliftPercent,
    currentBlendedCac,
    proposedBlendedCac,
    breakEvenMonths,
    monthlyProjection,
  };
}

// ─── Utility ────────────────────────────────────────────────────────

export function formatCurrency(value: number, decimals: number = 2): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatPercent(value: number, decimals: number = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-AU").format(Math.round(value));
}
