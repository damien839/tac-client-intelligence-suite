import { formatCurrency } from "@/lib/calculations";
import { TierConfig } from "@/lib/shipping-sim/types";

/** Human summary of a standard-tier config: "$9.95, free over $100" / "$9.95 flat" / "—". */
export function describeStandard(config: TierConfig | undefined): string {
  if (!config) return "—";
  return config.freeThreshold === null
    ? `${formatCurrency(config.fee)} flat`
    : `${formatCurrency(config.fee)}, free over $${config.freeThreshold}`;
}

/** Currency string with an explicit leading "+" for non-negative values. Values below
 * display precision (half a cent, incl. negative zero and float residue) normalise to 0
 * so a no-op never renders as "-$0.00". */
export function signedCurrency(n: number): string {
  const normalized = Math.abs(n) < 0.005 ? 0 : n;
  return (normalized >= 0 ? "+" : "") + formatCurrency(normalized);
}
