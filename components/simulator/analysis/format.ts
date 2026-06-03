import { formatCurrency } from "@/lib/calculations";

export type Trend = "up" | "down" | "neutral";

/** Currency string with an explicit leading "+" for non-negative values. */
export function signedCurrency(n: number): string {
  return (n >= 0 ? "+" : "") + formatCurrency(n);
}

/** A metric where a higher value is better (revenue, profit, recovery). */
export function goodIfPositive(delta: number): Trend {
  return delta > 0 ? "up" : delta < 0 ? "down" : "neutral";
}

/** A metric where a lower value is better (carrier spend, cost). */
export function goodIfNegative(delta: number): Trend {
  return delta < 0 ? "up" : delta > 0 ? "down" : "neutral";
}

/** Direction-aware phrase for a carrier-spend delta (negative = saving). */
export function carrierSpendSummary(delta: number): string {
  return delta < 0
    ? `carrier savings of ${formatCurrency(-delta)}`
    : `a carrier cost rise of ${formatCurrency(delta)}`;
}
