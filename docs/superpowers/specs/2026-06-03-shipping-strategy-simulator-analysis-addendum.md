---
title: Shipping Strategy Simulator Analysis Addendum
date: 2026-06-03
tags: [claude]
project: personal
status: active
type: note
---

# Shipping Strategy Simulator — Analysis Layer (Addendum)

**Date:** 2026-06-03
**Status:** Approved (reference preview signed off by Damo)
**Extends:** `2026-06-03-shipping-strategy-simulator-design.md`
**Reference implementation:** `scripts/preview-simulator-output.mjs` (generates the approved HTML preview)

## Why

The first cut's output (3 deltas + a current/proposed table) was too thin for a
client-facing consulting deliverable. This addendum adds a derived-analytics
layer and a richer Step-4 panel that explains the *why* and the *so-what*.

## New pure layer — `lib/shipping-sim/analysis.ts`

A single `analyze()` composes `simulate()` with additional derived metrics. All
pure, deterministic, TDD'd. New types live in `types.ts`.

```ts
interface TierEconomics {
  tier: CanonicalTier;
  count: number;
  feeRevenue: number;
  carrierCost: number;
  net: number;          // feeRevenue - carrierCost
  recoveryRate: number; // feeRevenue / carrierCost (0 when carrierCost is 0)
}

interface OrderMovement {
  gross: number;
  chosenTier: CanonicalTier;
  chosenFee: number;
  landedTier: CanonicalTier;
  landedFee: number;
  moved: boolean;
  netDelta: number;     // (landedFee - landedCarrier) - (chosenFee - chosenCarrier)
}

interface ThresholdSweepPoint { threshold: number; netShippingProfit: number; }

interface Analysis {
  benchmark: Benchmark;            // existing simulate() output
  recoveryCurrent: number;         // current.shippingRevenue / current.carrierSpend
  recoveryProposed: number;
  subsidyCurrent: number;          // carrier cost of orders that ship free (fee 0)
  subsidyProposed: number;
  freeOrdersCurrent: number;
  freeOrdersProposed: number;
  tierEconomicsCurrent: TierEconomics[];
  tierEconomicsProposed: TierEconomics[];
  movement: OrderMovement[];       // one row per order
  movedCount: number;
  thresholdSweep: ThresholdSweepPoint[]; // sweep one tier's free-over line
  optimalThreshold: number;        // threshold maximising net shipping profit
  optimalNet: number;
  netDeltaPerOrder: number;        // benchmark.netProfitDelta / order count
}

function analyze(
  orders: TaggedOrder[],
  current: Scheme,
  proposed: Scheme,
  opts?: { cogsPercent?: number; sweepTier?: CanonicalTier; sweepMax?: number; sweepStep?: number }
): Analysis
```

Defaults: `sweepTier = "standard"`, `sweepMax = 400`, `sweepStep = 10`. The sweep
varies that tier's `freeThreshold` in the proposed scheme, holding everything else
fixed, recomputing net shipping profit at each step. Orders whose chosen tier is
absent from the current scheme are skipped (consistent with `currentScenario`).

## New Step-4 panel sections (components/simulator/analysis/*)

Each a small focused component fed by `Analysis`:

1. **VerdictHeader** — adopt/revise banner + 4 KPI cards (net P&L Δ, cost recovery, carrier spend, orders reshuffled).
2. **ReconciliationBadge** — existing trust check (moved out of BenchmarkPanel).
3. **ProfitBridge** — inline-SVG waterfall: current net → +fee revenue → +carrier savings → proposed net.
4. **RecoveryGauges** — current vs proposed cost-recovery bars with a 100% break-even marker.
5. **TierEconomicsTable** — per-tier orders / fee revenue / carrier cost / net / recovery, current→proposed.
6. **MovementTable** — per-order cart / chose / paid / lands / new fee / Δnet; shifted rows highlighted.
7. **CarrierMixChart** — Recharts grouped bar, current vs proposed order counts per tier.
8. **AovDistribution** — inline-SVG strip of orders by cart value with threshold markers.
9. **ThresholdSweepChart** — Recharts line of net profit vs threshold, marking now / proposed / optimal.
10. **Findings** — bullets generated from the Analysis numbers + a scaled-impact note.

`BenchmarkPanel` becomes a thin orchestrator composing these. The wizard calls
`analyze()` (not `simulate()` directly) and gains an optional **monthly orders**
input (like COGS) used only for the clearly-labelled "illustrative" scaling line —
no naked revenue claim: per-order figure × stated volume, formula shown.

## Testing

`analyze()` is TDD'd in `lib/shipping-sim/__tests__/analysis.test.ts`: tier
economics aggregation, recovery rates (+ /0 guard), subsidy & free-order counts,
movement rows (moved flag + netDelta sign), sweep length + optimal selection,
netDeltaPerOrder (+ empty-orders guard). UI sections verified by build + manual QA.