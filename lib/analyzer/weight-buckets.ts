import "server-only";

/**
 * Canonical weight buckets for size-break analysis. Inclusive lower, exclusive upper.
 * The 22kg ceiling matches the AusPost/StarTrack max-parcel cutoff — anything heavier
 * is freight, not parcel, and shouldn't be in the volume table.
 */
export const WEIGHT_BUCKETS: ReadonlyArray<{
  id: string;
  min_kg: number;
  max_kg: number;
  label: string;
}> = [
  { id: "under_1kg", min_kg: 0, max_kg: 1, label: "0–1 kg" },
  { id: "1_to_3kg", min_kg: 1, max_kg: 3, label: "1–3 kg" },
  { id: "3_to_5kg", min_kg: 3, max_kg: 5, label: "3–5 kg" },
  { id: "5_to_10kg", min_kg: 5, max_kg: 10, label: "5–10 kg" },
  { id: "10_to_22kg", min_kg: 10, max_kg: 22, label: "10–22 kg" },
];

export interface WeightBucketShare {
  id: string;
  min_kg: number;
  max_kg: number;
  label: string;
  share: number;
  midpoint_kg: number;
}

const DEFAULT_SIGMA = 0.6;

/**
 * Approximates the actual weight mix when only avg_weight_kg is captured.
 * Uses a lognormal distribution with sigma=0.6 (industry-typical spread for
 * mixed ecom parcels) and median equal to avg_weight_kg.
 *
 * Returns shares that sum to 1.0 — the tail beyond 22kg gets folded into the
 * top bucket so we don't lose volume to the model. If avg_weight_kg is null
 * we degrade gracefully to a flat default (1.5kg avg, the AU ecom mean).
 */
export function distributeAcrossBuckets(
  avgWeightKg: number | null
): WeightBucketShare[] {
  const median = avgWeightKg && avgWeightKg > 0 ? avgWeightKg : 1.5;
  const mu = Math.log(median);

  const rawShares = WEIGHT_BUCKETS.map((bucket) => {
    const lower = bucket.min_kg <= 0 ? 0 : lognormCdf(bucket.min_kg, mu, DEFAULT_SIGMA);
    const upper = lognormCdf(bucket.max_kg, mu, DEFAULT_SIGMA);
    return Math.max(0, upper - lower);
  });

  // Fold the tail past 22kg into the top bucket so the share total = 1.
  const tail = 1 - lognormCdf(22, mu, DEFAULT_SIGMA);
  rawShares[rawShares.length - 1] += Math.max(0, tail);

  const total = rawShares.reduce((s, n) => s + n, 0) || 1;
  return WEIGHT_BUCKETS.map((bucket, idx) => ({
    id: bucket.id,
    min_kg: bucket.min_kg,
    max_kg: bucket.max_kg,
    label: bucket.label,
    share: rawShares[idx] / total,
    midpoint_kg: midpointKg(bucket.min_kg, bucket.max_kg, median),
  }));
}

/**
 * For costing, we need a representative weight per bucket. Use the bucket
 * midpoint, but clamp to the median when the median sits inside the bucket
 * (so the dominant bucket prices at the actual avg weight, not the mid).
 */
function midpointKg(min: number, max: number, median: number): number {
  if (median >= min && median <= max) return median;
  return (min + max) / 2;
}

function lognormCdf(x: number, mu: number, sigma: number): number {
  if (x <= 0) return 0;
  const z = (Math.log(x) - mu) / (sigma * Math.SQRT2);
  return 0.5 * (1 + erf(z));
}

/**
 * Abramowitz & Stegun 7.1.26 — max error ≈ 1.5e-7. Good enough for
 * percentage shares of a freight cost model.
 */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y =
    1 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}
