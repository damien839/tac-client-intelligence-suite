import { formatCurrency } from "@/lib/calculations";
import { TierConfig } from "@/lib/shipping-sim/types";

/** Human summary of a standard-tier config: "$9.95, free over $100" / "$9.95 flat" / "—". */
export function describeStandard(config: TierConfig | undefined): string {
  if (!config) return "—";
  return config.freeThreshold === null
    ? `${formatCurrency(config.fee)} flat`
    : `${formatCurrency(config.fee)}, free over $${config.freeThreshold}`;
}

/** Currency string with an explicit leading "+" for non-negative values (negative zero normalised). */
export function signedCurrency(n: number): string {
  const normalized = n === 0 ? 0 : n; // avoid "+-$0.00" from negative zero
  return (normalized >= 0 ? "+" : "") + formatCurrency(normalized);
}
