import { CanonicalTier, RecommendationId, SchemeEvaluation } from "@/lib/shipping-sim/types";

export type OptionKey = RecommendationId | "custom";

/** One column of the comparative report — a fully evaluated scheme option. */
export interface ReportOption {
  key: OptionKey;
  label: string;
  shortLabel: string;
  color: string;
  schemeSummary: string;
  threshold: number | null; // standard free-over line (null = flat / no free shipping)
  evaluation: SchemeEvaluation;
  unconstrained?: boolean;
}

export const OPTION_SHORT_LABELS: Record<OptionKey, string> = {
  "profit-first": "Profit",
  "threshold-fee": "Optimised",
  "basket-builder": "Basket",
  custom: "Custom",
};

export const OPTION_COLORS: Record<OptionKey, string> = {
  "profit-first": "#F5B36B",
  "threshold-fee": "#6088aa",
  "basket-builder": "#4ADE80",
  custom: "#C084FC",
};

export const NEUTRAL_COLOR = "#A0AEB8";

/** Tier-series hues for the volume-mix chart — readable on dark, distinct from OPTION_COLORS. */
export const TIER_COLORS: Record<CanonicalTier, string> = {
  standard: "#5EEAD4",
  express: "#F472B6",
  nextday: "#FACC15",
  sameday: "#818CF8",
};

// Shared recharts idioms (dark theme), carried over from the v2 report.
export const TOOLTIP_STYLE = {
  backgroundColor: "#1F3040",
  border: "1px solid #2D4050",
  borderRadius: 8,
  color: "#fff",
} as const;

export const GRID_STROKE = "#2D4050";

export const AXIS_TICK = { fontSize: 11, fill: "#A0AEB8" } as const;
