/** Dense $10-bin runs of order values. */
export interface ValueCluster {
  /** Inclusive lower edge of the dense run ($10 bins). */
  lo: number;
  /** Exclusive upper edge. */
  hi: number;
  /** Total order count across all bins in this run. */
  count: number;
}

/**
 * Compute dense $10-bin runs of order gross values.
 *
 * Binning:  bin k covers [k*10, (k+1)*10).
 * Density:  a bin is dense when its count >= max(3, 0.25 * largestBinCount).
 * Merging:  contiguous dense bins are merged into one cluster with summed count.
 * Output:   clusters sorted by count descending, capped at 6.
 *
 * Returns [] for empty input or when no bin meets the density threshold.
 */
export function valueClusters(grossValues: number[]): ValueCluster[] {
  if (grossValues.length === 0) return [];

  // Build a sparse bin-count map: binIndex → count
  const binCounts = new Map<number, number>();
  for (const v of grossValues) {
    const bin = Math.floor(v / 10);
    binCounts.set(bin, (binCounts.get(bin) ?? 0) + 1);
  }

  if (binCounts.size === 0) return [];

  const binEntries = Array.from(binCounts.entries());

  // Find the largest bin count to compute the density floor
  let maxCount = 0;
  for (const [, count] of binEntries) {
    if (count > maxCount) maxCount = count;
  }

  const densityFloor = Math.max(3, 0.25 * maxCount);

  // Collect dense bin indices, sorted ascending
  const denseBins: number[] = [];
  for (const [bin, count] of binEntries) {
    if (count >= densityFloor) {
      denseBins.push(bin);
    }
  }

  if (denseBins.length === 0) return [];

  denseBins.sort((a, b) => a - b);

  // Merge contiguous dense bins into clusters
  const clusters: ValueCluster[] = [];
  let clusterStart = denseBins[0];
  let clusterEnd = denseBins[0];
  let clusterCount = binCounts.get(denseBins[0])!;

  for (let i = 1; i < denseBins.length; i++) {
    const bin = denseBins[i];
    if (bin === clusterEnd + 1) {
      // Contiguous — extend current cluster
      clusterEnd = bin;
      clusterCount += binCounts.get(bin)!;
    } else {
      // Gap — finalise current cluster and start a new one
      clusters.push({
        lo: clusterStart * 10,
        hi: (clusterEnd + 1) * 10,
        count: clusterCount,
      });
      clusterStart = bin;
      clusterEnd = bin;
      clusterCount = binCounts.get(bin)!;
    }
  }
  // Finalise the last cluster
  clusters.push({
    lo: clusterStart * 10,
    hi: (clusterEnd + 1) * 10,
    count: clusterCount,
  });

  // Sort by count descending, cap at 6
  return clusters
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

/**
 * Unit-driven free-over threshold candidates.
 *
 * For each cluster: candidate = hi + typicalUnitPrice, rounded UP to the next
 * $5 multiple (exact $5 multiples are unchanged).
 *
 * Returns deduplicated, ascending-sorted candidates, capped at 8.
 *
 * Returns [] for empty clusters.
 */
export function unitDrivenThresholds(
  clusters: ValueCluster[],
  typicalUnitPrice: number,
): number[] {
  if (clusters.length === 0) return [];

  const seen = new Set<number>();

  for (const cluster of clusters) {
    const raw = cluster.hi + typicalUnitPrice;
    // Round UP to the next $5 multiple (exact multiples stay)
    const candidate = Math.ceil(raw / 5) * 5;
    seen.add(candidate);
  }

  return Array.from(seen)
    .sort((a, b) => a - b)
    .slice(0, 8);
}
