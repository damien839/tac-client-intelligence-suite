import { CandidateScheme, CanonicalTier, SchemeEvaluation } from "@/lib/shipping-sim/types";

/** One row/column of the comparative report — a candidate scheme plus its evaluation. */
export interface ReportOption extends CandidateScheme {
  /** Chart/series colour, assigned by grid position. */
  color: string;
  evaluation: SchemeEvaluation;
}

/**
 * The single honesty caveat the report must carry. Rendered under the comparison
 * grid and in the findings footer so it survives into the printed PDF.
 */
export const MECHANICAL_CAVEAT =
  "Assumes order volume and customer behaviour unchanged — more orders paying a fee is shown as pure gain; real-world abandonment risk is not modelled.";

/** Series hues for candidate rows, assigned by grid position. Readable on dark. */
export const OPTION_PALETTE = [
  "#A0AEB8", // Current — deliberately neutral
  "#F5B36B",
  "#4ADE80",
  "#C084FC",
  "#5EEAD4",
  "#F472B6",
  "#FACC15",
  "#818CF8",
] as const;

export function optionColor(index: number): string {
  return OPTION_PALETTE[index % OPTION_PALETTE.length];
}

export const NEUTRAL_COLOR = "#A0AEB8";

/** TAC accent — the single-series highlight used by the curve-anatomy charts. */
export const ACCENT_COLOR = "#F5B36B";

/** A labelled reference line on a value axis (sensitivity-chart option markers). */
export interface ThresholdMarker {
  value: number;
  label: string;
  color: string;
}

/** Tier-series hues for the volume-mix chart — readable on dark, distinct from OPTION_PALETTE. */
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
