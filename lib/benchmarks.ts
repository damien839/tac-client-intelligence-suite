/**
 * TAC Benchmark Constants for Module 2: Cost Audit
 * 
 * These are TAC-defined industry benchmarks.
 * All values are editable in the UI — these serve as defaults.
 */

export interface BenchmarkCategory {
  id: string;
  label: string;
  unit: string;
  low: number;
  high: number;
  description: string;
}

export const warehouseBenchmarks: BenchmarkCategory[] = [
  {
    id: "receiving",
    label: "Receiving",
    unit: "cartons/hr",
    low: 25,
    high: 45,
    description: "Inbound carton processing rate",
  },
  {
    id: "putaway",
    label: "Putaway",
    unit: "moves/hr",
    low: 20,
    high: 35,
    description: "Inventory putaway rate",
  },
  {
    id: "pick_pack",
    label: "Pick & Pack",
    unit: "orders/hr",
    low: 15,
    high: 40,
    description: "Order fulfillment throughput",
  },
  {
    id: "cost_per_order",
    label: "Cost Per Order",
    unit: "$",
    low: 3.50,
    high: 8.00,
    description: "Total warehouse cost per order (labour + overhead)",
  },
  {
    id: "accuracy",
    label: "Order Accuracy",
    unit: "%",
    low: 99.0,
    high: 99.8,
    description: "Percentage of orders shipped correctly",
  },
];

export interface CarrierBenchmark {
  id: string;
  carrier: string;
  service: string;
  benchmarkCost: number;
  description: string;
}

export const carrierBenchmarks: CarrierBenchmark[] = [
  { id: "auspost_standard", carrier: "Australia Post", service: "Standard", benchmarkCost: 8.50, description: "eParcel standard domestic" },
  { id: "auspost_express", carrier: "Australia Post", service: "Express", benchmarkCost: 12.00, description: "eParcel express domestic" },
  { id: "startrack_premium", carrier: "StarTrack", service: "Premium", benchmarkCost: 10.50, description: "StarTrack premium domestic" },
  { id: "startrack_express", carrier: "StarTrack", service: "Express", benchmarkCost: 14.00, description: "StarTrack express domestic" },
  { id: "aramex_standard", carrier: "Aramex", service: "Standard", benchmarkCost: 7.00, description: "Aramex domestic standard" },
  { id: "tnt_road", carrier: "TNT", service: "Road Express", benchmarkCost: 9.50, description: "TNT road express" },
  { id: "dhl_express", carrier: "DHL", service: "Express", benchmarkCost: 18.00, description: "DHL domestic express" },
  { id: "sendle_standard", carrier: "Sendle", service: "Standard", benchmarkCost: 6.50, description: "Sendle standard domestic" },
];

/**
 * Score a client's metric against benchmark range.
 * Returns: "above" (green), "within" (amber), "below" (red)
 * 
 * For cost metrics, lower is better (invert logic).
 */
export function scoreBenchmark(
  value: number,
  benchmark: BenchmarkCategory,
  isLowerBetter: boolean = false
): "green" | "amber" | "red" {
  if (isLowerBetter) {
    if (value <= benchmark.low) return "green";
    if (value <= benchmark.high) return "amber";
    return "red";
  } else {
    if (value >= benchmark.high) return "green";
    if (value >= benchmark.low) return "amber";
    return "red";
  }
}
