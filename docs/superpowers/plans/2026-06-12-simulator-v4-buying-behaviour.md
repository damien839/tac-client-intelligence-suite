---
title: Simulator v4 Buying-Behaviour Redesign
date: 2026-06-12
tags: [claude]
project: tac
status: active
type: note
---

# Simulator v4 — Buying-Behaviour Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the three recommendation options per spec v4 (docs/superpowers/specs/2026-06-10-simulator-threshold-recommendations-design.md, "v4" section): Net profit maximiser (multi-tier sweep narrating freight shifting), unit-driven Basket-builder (thresholds from order clusters + typical unit price), Competitor benchmark (renamed Custom), buying-behaviour buckets, dual-mode Shopify parser.

**Architecture:** Parser gains a full-export mode (line items grouped by order Name → units + unit-price stats). A new pure `lib/shipping-sim/units.ts` derives value clusters and unit-driven threshold candidates. `recommend.ts` gets a generalised `RecommendedScheme` (carries a full candidate `Scheme`), a bounded multi-tier sweep for net-profit, the unit-driven basket sweep with slider fallback, and a segment engine for buckets. The UI renames/rewires options, adds the bucket-migration section, and reframes Custom as Competitor benchmark.

**Tech Stack:** unchanged (Next 14, TS strict, Vitest — 73 tests green at baseline, Papa Parse, recharts, tac-* tokens).

**Branch:** continue on `feat/simulator-options-comparison`. No merge to main without Damo's sign-off.

**Fidelity note:** tasks below specify exact public contracts (types, signatures, test cases — the tests ARE the contract) with implementation guidance; implementers TDD inside them. Reviews enforce contract compliance.

---

## Task 1: Dual-mode parser + unit stats

**Files:** modify `lib/shipping-sim/parse.ts`, `lib/shipping-sim/types.ts`; test `lib/shipping-sim/__tests__/parse.test.ts` (6 existing tests must stay green).

**Types (types.ts):**

```ts
// OrderRow gains:
  units?: number; // total line-item quantity (full Shopify export only)

// New:
export interface UnitStats {
  typicalUnitPrice: number; // quantity-weighted median line-item price
  ordersWithUnits: number; // orders carrying line-item data
  unitShare: { single: number; double: number; threePlus: number }; // share of orders by item count, 0..1
}
```

`ParseResult` gains `unitStats: UnitStats | null` (null in summary mode or when no usable line items).

**Detection:** after header normalisation (existing lowercase/trim), full-export mode iff columns include `name` AND `lineitem quantity` AND `lineitem price` (plus the existing gross/shipping/service columns). Otherwise summary mode = existing behaviour exactly, with `unitStats: null` and no `units` on orders.

**Full-export grouping:** Shopify puts order-level fields only on each order's FIRST row; later rows of the same `name` have blank Total/Shipping. Group consecutive-or-not rows by `name`; the order's gross/shippingPaid/rawService come from the row where gross parses (warn + skip the order if none does); `units` = Σ `lineitem quantity` over the group (rows with unparseable quantity contribute 0 + one aggregate warning); unit-price pairs (price, qty) collected for stats. Distinct services from order rows only.

**Stats:** `typicalUnitPrice` = quantity-weighted median over all (price, qty) pairs (sort by price, walk cumulative qty to the midpoint). `unitShare` from per-order `units` (1 / 2 / ≥3), denominators = ordersWithUnits.

**Contract tests (write first, must fail, then implement):**

```ts
const FULL = [
  "Name,Total,Shipping,Shipping Method,Lineitem quantity,Lineitem price",
  "#1001,150.00,9.95,Standard Shipping,1,80.00",
  "#1001,,,,2,30.00",            // second line item of #1001
  "#1002,90.00,9.95,Standard Shipping,1,90.00",
  "#1003,300.00,0.00,Express Shipping,3,100.00",
].join("\n");
```

- parses 3 orders (not 5); #1001 has `units: 3`, gross 150; #1003 `units: 3`.
- `services` = ["Express Shipping", "Standard Shipping"]; no skipped-row warning for the blank continuation rows.
- `unitStats.typicalUnitPrice`: pairs (80×1, 30×2, 90×1, 100×3) → qty-sorted prices [30,30,80,90,100,100,100], total qty 7, midpoint the 4th → **90**. Assert 90.
- `unitStats.unitShare` = { single: 1/3, double: 0, threePlus: 2/3 } (toBeCloseTo).
- An order whose every row has unparseable gross → order skipped + warning mentioning the order name count.
- Summary-mode CSV (existing fixtures) → identical results to today + `unitStats: null`; all 6 existing tests untouched and green.

Commit: `feat(simulator): dual-mode Shopify parser with unit stats`

---

## Task 2: Clusters + unit-driven threshold candidates

**Files:** create `lib/shipping-sim/units.ts`; test `lib/shipping-sim/__tests__/units.test.ts`.

```ts
export interface ValueCluster {
  lo: number; // inclusive lower edge of the dense run ($10 bins)
  hi: number; // exclusive upper edge
  count: number;
}

/** Dense $10-bin runs of order values. A bin is dense when count >= max(3, 25% of the
 * largest bin). Contiguous dense bins merge into one cluster. Returns clusters sorted
 * by count desc, capped at 6. */
export function valueClusters(grossValues: number[]): ValueCluster[]

/** Unit-driven free-over candidates: for each cluster, hi + typicalUnitPrice rounded UP
 * to the next $5, deduped, sorted ascending, capped at 8. */
export function unitDrivenThresholds(clusters: ValueCluster[], typicalUnitPrice: number): number[]
```

**Contract tests:**

- 30 orders at 95–105 + 10 scattered 200–600 (one per bin) → one dominant cluster covering the 90–110 bins; scattered singleton bins are not clusters (below the max(3, 25%·max) floor).
- Two separated dense bands → two clusters, count-desc order.
- `unitDrivenThresholds([{lo:140,hi:170,count:20}], 45)` → [215] (170+45 = 215, already a $5 multiple); with typical 42 → 170+42=212 → rounds UP to 215.
- Dedupe: two clusters whose candidates collide produce one entry.
- Empty input → [].

Commit: `feat(simulator): value clusters + unit-driven threshold candidates`

---

## Task 3: Engine — generalised RecommendedScheme, net-profit sweep, unit-driven basket sweep, segments

**Files:** modify `lib/shipping-sim/recommend.ts`, `lib/shipping-sim/types.ts`; tests in `recommend.test.ts`. This is the heavy task — keep `behavioralScenario`/`evaluateScheme`/`prepareBuckets`/`bucketOrders`/`dominantPaidTier`/`thresholdCurves` semantics UNCHANGED (all existing tests for them stay green verbatim).

**3a. RecommendedScheme generalised (breaking change to the type):**

```ts
export type RecommendationId = "net-profit" | "basket-builder";

export interface RecommendedScheme {
  id: RecommendationId;
  label: string; // "Net profit maximiser" | "Basket-builder"
  scheme: Scheme; // the full candidate scheme (may change multiple tiers)
  changedTiers: CanonicalTier[]; // tiers whose fee/threshold differ from current
  // ...all existing metric fields stay (contributionDelta, netShippingProfitDelta,
  // upliftMarginGain, abandonMarginLoss, expectedOrdersLost, freeOrderShare,
  // recoveryRate, unconstrained, capPinned)
  // REMOVED: tier, fee, threshold (replaced by scheme + changedTiers)
  basketNarrative?: string; // basket-builder only: "Free over $215 — your $140–$170 orders add one ~$45 unit to qualify."
}
```

**3b. New signature:** `recommendOptions(orders, current, behavior, unitStats: UnitStats | null): RecommendedScheme[]` returning exactly two entries (net-profit, basket-builder). The old three-option shape is gone.

**Net-profit sweep** (both paid tiers when ≥2 used; single-tier data degrades to the existing 2D sweep on that tier):
- Levers: stdT ∈ thresholdCandidates coarse (step $20 + null), stdFee ∈ $0..max(2×stdFee, $30) step $2, expFee ∈ $0..max(2×expFee, $30) step $2, expT ∈ {current expT, null} ∪ unitDrivenThresholds (when unitStats present). Uplift forced off (matching old A/B), abandonment live.
- Coarse argmax then ONE refine pass: re-sweep ±1 coarse step around the winner at fine steps ($10 / $1 / $1). Document the budget in a comment (coarse ≈ 21×16×16×≤10 ≈ 54k evals worst case; if `prepared.length > 1500`, double the coarse steps — same pattern as the bucketing cap).
- `changedTiers` computed by config inequality vs current.

**Basket-builder sweep:**
- With unitStats: candidates = unitDrivenThresholds over the order grosses' clusters, applied as single-tier changes to EACH paid tier (fee unchanged) plus the best-std × best-exp combination; uplift ON with `upliftWindow = typicalUnitPrice` (override the slider for this option; echo must say so); abandonment live. `basketNarrative` built from the winning candidate's source cluster + typical unit price.
- Without unitStats: fall back to today's slider-driven threshold sweep on `dominantPaidTier` (uplift on, window from slider); no narrative.

**Degeneracy guards:** keep `unconstrained` (abandonRate===0 + charges-everyone/null/cap arms) and `capPinned` (any swept lever at its range edge) — now evaluated per changed lever.

**3c. Segments:**

```ts
export type ItemBand = "single" | "double" | "threePlus" | "unknown";
export type ValuePosition = "wellBelow" | "withinOneUnit" | "atOrAbove"; // vs the order's CURRENT tier threshold; flat tier => wellBelow unless free

export interface Segment {
  key: string; // e.g. "single|withinOneUnit|standard"
  itemBand: ItemBand;
  position: ValuePosition;
  tier: CanonicalTier;
  orders: number;
  valueShare: number; // share of total gross, 0..1
}

export interface SegmentOutcome {
  segmentKey: string;
  pays: number; free: number; builds: number; switches: number; abandons: number; // EV-weighted orders
}

/** Static segmentation vs the CURRENT scheme. window = typicalUnitPrice ?? upliftWindow. */
export function segmentOrders(orders: TaggedOrder[], current: Scheme, window: number): Segment[]

/** Per-option outcome of each segment under a candidate scheme (same behaviour params
 * as the option's evaluation). Runs behavioralScenario per segment subset. */
export function segmentOutcomes(orders: TaggedOrder[], current: Scheme, candidate: Scheme, behavior: BehaviorParams, window: number): SegmentOutcome[]
```

Empty segments are omitted. `builds`/`abandons`/`switches` come from the scenario's impact/expectedOrdersLost; `free` = completing × freeOrderShare of that subset; `pays` = completing − free.

**Contract tests (representative — implementer writes these plus edge cases):**
- recommendOptions returns exactly [net-profit, basket-builder]; both `scheme` values differ from or equal current with `changedTiers` consistent (config-inequality checked).
- Net-profit on Damo-shaped data (std $30/250/cost 25; exp $60 flat/cost 55; 12 free std + 3 paying std + 45 exp 110–600; cogs .3, uplift .3, window 20, abandon .1): assert it evaluates express levers — at minimum `changedTiers` ⊆ {standard, express} and `contributionDelta ≥ 0`; assert the freight-shift accounting is visible: if the winner shifts volume, `evaluateScheme(winner.scheme).volumeByTier.standard > currentFacts.volumeByTier.standard` (conditional assertion structured so the test is deterministic — pick the fixture so a shift IS profitable: e.g. express premium far above revealed premium for a band of orders).
- Refine pass: winner's contribution ≥ every coarse candidate's (sample-check a handful).
- Basket-builder with unitStats: given a fixture with a dense cluster at 140–170 and typicalUnitPrice 45, the winner's changed threshold = 215 and `basketNarrative` contains "$215", "one", and "45". Window override: echo of uplift uses 45 not the slider value (assert via the evaluation maths: an order at 175 builds — within 45 of 215 — while the slider window of 20 would exclude it).
- Basket-builder without unitStats === old slider behaviour on the dominant tier (cross-check against a direct evaluateScheme sweep).
- Self-no-op invariant still holds (current vs current with full behaviour = zeros).
- segmentOrders: hand-built 6-order fixture covering all three positions × two tiers; valueShare sums to 1; window from typical unit.
- segmentOutcomes: per-segment pays/free/builds/switches/abandons sum across segments to the whole-book scenario numbers (toBeCloseTo) — the partition property.

Commit in two steps: `feat(simulator): net-profit multi-tier sweep + unit-driven basket sweep` then `feat(simulator): buying-behaviour segments`.

---

## Task 4: UI rewiring

**Files:** `components/simulator/steps/StepProposal.tsx`, `components/simulator/OptionsComparison.tsx`, `components/simulator/ComparisonReport.tsx`, `components/simulator/report/*` (new `SegmentMigration.tsx`; update types/colors), `components/simulator/steps/StepUpload.tsx`, wizard (pass unitStats through).

- **Wizard/StepUpload:** `parseShippingOrders` result's `unitStats` stored in wizard state and passed to StepProposal. Upload copy: full export recommended ("include line items to unlock unit-driven recommendations"); show a badge when unit data detected ("✓ line items detected — unit-driven analysis on").
- **StepProposal:** reportOptions built from `rec.scheme` directly (no reconstruction); two rec columns + Competitor; per-option evaluation params: net-profit = uplift off; basket-builder = uplift on with window override (typicalUnitPrice when present). Assumption echo states the window source. Uplift-window slider shows but is annotated "(auto: $X/unit from your data)" and disabled when unitStats present — simplest honest UX.
- **OptionsComparison:** columns Current | Net profit maximiser | Basket-builder | **Competitor benchmark**; scheme rows read each option's `scheme[tier]` directly (multi-tier changes render naturally); explainer updated (no longer "re-price your X service" — net-profit may change both; say which tiers each option changes via `changedTiers`); Competitor column intro/tooltip carries the RRP caveat; "= current" badges stay (matchesCurrent = changedTiers.length === 0).
- **ComparisonReport:** verdict/findings updated for two recs + competitor (freight-shift sentence: orders moved to standard and carrier saving — from volumeByTier deltas; basket narrative quoted in findings when present); AOV section gains cluster shading (optional, only if cheap — else markers suffice) and threshold markers from each option's changed tiers; **new `SegmentMigration.tsx`** section replacing OrderImpactTable as the primary story: table of segments (name, orders, value share) × per-option outcome summary (dominant movement, e.g. "12 build · 3 abandon"), explainer in plain English; keep OrderImpactTable beneath as the compact totals view or fold its totals into the section footer (implementer's judgment, note the choice).
- **Competitor caveat (printed):** "Assumes your product pricing (RRP) is comparable to the competitor's — if their RRP differs, this is not like-for-like."
- Sensitivity chart: keep (dominant-tier curve), caption notes it shows one lever in isolation.

Build + 73-equivalent tests green (engine tests updated count from Task 3). Commit: `feat(simulator): v4 options, competitor benchmark, segment migration report`.

---

## Task 5: QA + finish

- Update `/tmp` QA walks: full-export CSV fixture (line items, multi-row orders) exercising: unit badge, unit-driven basket narrative, net-profit changedTiers including express on express-heavy data, segment section, competitor caveat, print pass. Summary-CSV regression walk (slider fallback).
- `npm test && npm run build`, push branch, hand back to Damo with before/after on the Damo-shaped fixture. NO merge to main.

---

## Self-Review

- Spec v4 §lineup → Task 3 (two recs) + Task 4 (competitor rename). §buckets → Task 3c + SegmentMigration. §parser → Task 1. §out-of-scope respected (no conversion-gain lever, no per-item surcharges). ✓
- Contracts: every new export has a signature + contract tests; RecommendedScheme breaking change is confined to Task 3 + Task 4 consumers (grep list: StepProposal, OptionsComparison via ReportOption, report/types). ✓
- Perf budgets stated for the multi-tier sweep with a documented degradation path. ✓
- No placeholders: tasks specify exact fixtures/expected values where determinism matters; implementer-authored edge tests are explicitly scoped. ✓
