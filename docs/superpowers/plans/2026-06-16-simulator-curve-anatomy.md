---
title: Simulator Curve Anatomy Section
date: 2026-06-16
tags: [claude]
project: tac
status: active
type: note
---

# Simulator — "Curve Anatomy" Section Implementation Brief

> **Status: BUILT 2026-06-17** on `feat/simulator-options-comparison`. Decisions: dot-strip retired, $25 bands, collapsible on screen / expanded in PDF. 15 curve tests added (147 total green).

**Why:** Our options report is a strong *decision* engine (three validated schemes, reconciliation gate, behavioural model) but skips the *diagnostic* layer — the description of the order-value curve that proves the problem before we recommend a fix. The Park Noire AOV Deep Dive (UK/EU, 523 orders) is the reference for that layer. This brief ports its cheap, high-impact widgets into our report and, critically, uses them to **show the evidence base for our behavioural assumptions** instead of asking clients to trust a slider.

**Scope discipline:** ~6 of the 8 deep-dive widgets are derivable from the order book we already parse. This brief builds those. Geo/market mix is explicitly **out of scope** (needs destination country, which the parser does not capture). We do **not** copy the deep-dive's contribution math — it omits carrier cost on paid parcels and overstates net; our existing math stays.

**Branch:** continue on `feat/simulator-options-comparison`. No merge to main without Damo's sign-off (merge = live deploy on Vercel Pro).

**Tech stack:** unchanged — Next 14, TS strict, Vitest (132 tests green at baseline), recharts (already used by report charts), inline SVG (used by `AovDistribution`), tac-* tokens.

---

## What gets built

A new **Curve Anatomy** section rendered in `ComparisonReport` between the "How to read this" card and the Verdict — i.e. read order becomes: *does the model match reality → how to read these → here's the shape of your problem → here are the options.*

Five widgets, all fed by one pure stats object:

1. **Distribution + skew** — binned histogram of order subtotals ($25 bands) with median / mean / current-threshold reference lines, beside a percentile ladder (p10–p99) and a one-line skew callout ("mean $X, median $Y — a Z% skew; half your orders sit below $Y"). Supersedes the current dot-strip `AovDistribution` for the descriptive view (the dot-strip stays where it is in the options context, or is retired — Damo's call, see Open Questions).
2. **Price-point clusters** — horizontal bars of the most common exact/near-exact subtotals, with the "one-item AOV" narrative ("$X alone = N orders → the growth lever is one item to two"). Reuses `valueClusters` from `units.ts` (already computed for threshold candidates; currently never surfaced).
3. **Threshold-pull zoom** — orders in $5 bands spanning ±$50 around the dominant tier's *current* free-ship line, highlighting the run-up below and any spike just above. This is the empirical proof the threshold already bends behaviour. Hidden when the dominant tier is flat (no threshold to build toward).
4. **Shipping-load curve** — the current fee as a % of order subtotal across bands ("$30 flat = 24% of the median basket; smallest carts punished hardest"). Uses the dominant tier's current fee.
5. **Context KPI strip** — two trivial additions: free-ship AOV vs paid AOV (the two populations), and shipping revenue as % of GMV.

---

## Task 1: Pure stats module

**Files:** new `lib/shipping-sim/curve.ts`; new types in `types.ts`; new test `lib/shipping-sim/__tests__/curve.test.ts`.

**Contract (`curve.ts`):** one entry point, pure, no UI.

```ts
export interface CurveStats {
  count: number;
  mean: number;
  median: number;
  stdev: number;
  min: number;
  max: number;
  percentiles: { p10:number; p25:number; p50:number; p75:number; p90:number; p95:number; p99:number };
  skewPct: number;                 // mean/median - 1, as a percentage
  histogram: { lo:number; hi:number|null; n:number }[];  // $25 bands; last band open-ended
  pricePoints: { value:number; n:number }[];             // top exact/near subtotals, desc, cap 12
  pullZone: {                                            // null when dominant tier is flat
    threshold:number;
    bands: { lo:number; n:number }[];                    // $5 bands, threshold-50 .. threshold+50
  } | null;
  shippingLoad: { lo:number; hi:number; loadPct:number; n:number }[]; // fee as % of band midpoint
  freeAov:number; paidAov:number; freeN:number; paidN:number;         // split by current free/paid
  shipRevPctGmv:number;            // Σ current fee / Σ gross
}

export function curveStats(
  orders: TaggedOrder[],          // the validOrders set (current scheme tier exists)
  current: Scheme,
  dominantTier: CanonicalTier | null,
): CurveStats;
```

**Definitions / decisions:**
- **Free vs paid** = per order, `tierCost(current[order.tier], gross) === 0` → free. Unambiguous under multi-tier (each order judged on its own tier).
- **Shipping load** uses the dominant tier's current `fee` (the band a client reads as "the shipping charge"). If dominant tier is flat-fee, load = fee/midpoint; if it has a threshold, bands at/above threshold show 0% (already free) — keep them, they tell the story.
- **Price points:** reuse `valueClusters(grossValues)` for dense runs, but ALSO surface exact-value frequency (the deep-dive's strongest signal was exact subtotals like $118.95 ×22). Decision: report exact-subtotal counts rounded to the cent, top 12 by count. `valueClusters` stays the threshold-candidate engine; price-points is a thin separate tally.
- **Histogram** band width fixed $25 (matches deep-dive; readable). Open-ended final band at the p99-rounded ceiling so the long tail doesn't stretch the axis.
- **Percentiles:** linear interpolation, standard. No external dep.

**Tests (write first):** known small fixture → exact mean/median/percentiles; histogram band edges (value exactly on a boundary lands in the upper band); free/paid split with a threshold and with a flat fee; pullZone null when flat; shippingLoad 0% above threshold; empty/degenerate (1 order, all-same-value) returns finite numbers, no NaN. Target ~15 tests.

---

## Task 2: Report widgets

**Files:** new components under `components/simulator/report/`:
- `CurveAnatomy.tsx` — section wrapper + KPI strip (widget 5), composes the four charts.
- `DistributionChart.tsx` (widget 1, recharts bar + reference lines) + inline percentile ladder.
- `PricePointBars.tsx` (widget 2, recharts horizontal bar).
- `PullZoneChart.tsx` (widget 3, recharts bar, threshold reference line).
- `ShippingLoadChart.tsx` (widget 4, recharts line).

Match existing report idioms: `TOOLTIP_STYLE`, `GRID_STROKE`, `AXIS_TICK`, `card` class, tac-* tokens, `text-tac-accent` headings, muted sub-labels. All copy plain/factual/imperative (TAC house style) — no salesy framing. Each chart carries a one-line "what this says" sub-header like the existing cards.

**Props:** `CurveAnatomy` takes `{ stats: CurveStats; tierLabel: string }`. Dumb component — all logic in `curve.ts`.

---

## Task 3: Wiring

**Files:** modify `components/simulator/steps/StepProposal.tsx`, `components/simulator/ComparisonReport.tsx`.

- StepProposal already has `validOrders`, `currentScheme`, `dominantTier` in scope. Add `const stats = useMemo(() => curveStats(validOrders, currentScheme, dominantTier), [...])` and pass to `ComparisonReport` as a prop.
- ComparisonReport: render `<CurveAnatomy stats={stats} tierLabel={tierLabel} />` immediately after `<HowToReadCard />`, before `<VerdictCard />`.
- Renders identically in the on-screen report and the PDF export (one component path).

---

## Out of scope (call out, don't silently drop)

- **Geo / market mix.** Needs destination country on `OrderRow` + the Shopify export to include it. Separate brief if wanted — it's a real new-data lift, not a presentation change.
- **Simulator "pull" rewrite.** The deep-dive's interactive top-up slider duplicates our existing behavioural model; not porting it.
- **Deep-dive's net-contribution formula.** Deliberately not copied (omits carrier cost on paid parcels).

## Open questions for Damo

1. **Dot-strip:** retire `AovDistribution` (replaced by the richer histogram) or keep both? Recommend retire to avoid two distribution views.
2. **Histogram band width:** $25 fixed (deep-dive parity) or adaptive to the book? Recommend $25.
3. **Section default state:** expanded, or collapsed-by-default with a "Curve anatomy" toggle to keep the report scannable? Recommend expanded in PDF, collapsible on screen.

## Verify

- `npx vitest run lib/shipping-sim` green (existing 132 + new curve tests).
- `npm run build` green.
- Manual: load a sample export, confirm widgets render and the pull-zone hides for a flat-fee tier.

## Effort

One pure lib file + types + ~15 tests, five small presentational components, three wiring edits. Self-contained; no change to the recommendation engine or its math.
