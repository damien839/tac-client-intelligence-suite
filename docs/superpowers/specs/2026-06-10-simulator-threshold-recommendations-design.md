---
title: Shipping Simulator — Threshold Recommendations
date: 2026-06-10
tags: [claude]
project: tac
status: active
type: note
---

# Shipping Strategy Simulator — Recommended Schemes (Design)

## Why

The simulator benchmarks a hand-built proposal but never recommends one. The analysis layer's existing "optimal threshold" (the green line on the sweep chart) is a byproduct, not a recommendation — and under the current model it is degenerate: customers never abandon and carts never grow, so raising the threshold or fee almost always increases modelled profit and the "optimal" pins at the top of the sweep range.

This feature adds a **Recommended schemes** section to Step 4: three option cards computed by a new pure recommendation engine that introduces two transparent, tunable behavioural counterweights — basket-building uplift and abandonment.

## The three options

All options maximise the same objective — **expected total contribution Δ vs current** (shipping P&L delta plus product-margin effects) — and differ only in levers and behaviour:

| Card | Levers (standard tier only) | Uplift | Abandonment |
|---|---|---|---|
| **A. Profit-first** | free-over threshold (fee fixed at current) | off (forced 0) | on |
| **B. Optimised threshold + fee** | threshold × fee, 2D grid | off (forced 0) | on |
| **C. Basket-builder** | free-over threshold (fee fixed at current) | on (user sliders) | on |

Non-swept values (other tiers, and the standard fee for A/C) are taken from the **current scheme**, not the in-progress proposal. This keeps the cards stable — applying a card or hand-editing the proposal never changes what the cards say.

Each sweep also evaluates `freeThreshold: null` (flat rate, no free shipping) as a candidate.

## Behavioural model

New params, all surfaced as sliders next to the cards:

```ts
export interface BehaviorParams {
  cogsPercent: number;   // 0..1 — required for recommendations
  upliftRate: number;    // 0..1, default 0.30
  upliftWindow: number;  // $, default 20
  abandonRate: number;   // 0..1, default 0.10
}
```

Per order, expected-value weighted (fractional orders — deterministic, no sampling):

1. **Land** the order under the candidate scheme via the existing `landedTier()` (revealed-WTP unchanged). Let `landedFee` be its shipping cost and `currentFee` its cost under the current scheme.
2. **Basket-building** (Option C only): if the landed tier has threshold `T`, `landedFee > 0`, and `T − upliftWindow ≤ gross < T`, then with weight `upliftRate` the order builds to `T`: ships free, carrier cost unchanged, gains product margin `(T − gross) × (1 − cogsPercent)`.
3. **Abandonment**: of the remaining weight, if `landedFee > currentFee` (customer is worse off than today), weight `abandonRate` abandons: no shipping revenue, no carrier cost, and loses product margin `gross × (1 − cogsPercent)`.
4. **Otherwise** the order completes at `landedFee` as in the existing model.

So an in-window, worse-off order splits `u` build / `(1−u)·a` abandon / `(1−u)(1−a)` pay.

**Objective per candidate:** `contributionDelta = (netShippingProfit_candidate − netShippingProfit_current) + upliftMarginGain − abandonMarginLoss`. With uplift and abandonment at 0 this reduces exactly to today's sweep objective.

**Degeneracy guard:** with `abandonRate === 0`, a card's optimum is flagged unconstrained when it sits at the top of the threshold or fee range, is the flat (`null`) candidate, or grants free shipping to no one (`freeOrderShare === 0` — a charges-everyone optimum below the range edge). The card shows a warning that the optimum may be unreliable and the abandonment slider should be set. (As built — broader than the original "top of range" wording; the extra arms catch effectively-flat optima the edge check would miss.)

## Sweep ranges

- Threshold: `$0 … ceil(p95(gross)/10)×10` (min $400, cap $1000), step $10, plus the `null` candidate.
- Fee (Option B only): `$0 … max(2 × current standard fee, $30)`, step $1.

## Performance — bucketing

Orders are grouped by exact `(tier, gross)` before sweeping; every order in a bucket behaves identically under the model, so each candidate evaluates buckets (typically hundreds–low thousands) instead of raw orders. If distinct buckets exceed 5,000, gross is rounded to the dollar first. A unit test asserts bucketed results match per-order results (exact for exact bucketing; tight tolerance for rounded).

Everything runs in `useMemo` on the client; with ~1,300 grid combos × ≤5,000 buckets this stays comfortably interactive.

## New pure layer

`lib/shipping-sim/recommend.ts` — zero React/IO, strict TDD:

- `bucketOrders(orders: TaggedOrder[]): OrderBucket[]`
- `behavioralScenario(buckets, current, candidate, behavior): BehavioralResult` — expected shippingRevenue, carrierSpend, upliftMarginGain, abandonMarginLoss, expectedOrders, freeOrderShare, recoveryRate
- `recommendOptions(orders, current, behavior): RecommendedScheme[]` — runs the three sweeps and returns one ranked best candidate per option with its metrics

Types (`RecommendedScheme`, `BehaviorParams`, `OrderBucket`, `BehavioralResult`) live in `lib/shipping-sim/types.ts` with the other shared types.

```ts
export interface RecommendedScheme {
  id: "profit-first" | "threshold-fee" | "basket-builder";
  label: string;
  threshold: number | null;      // recommended standard free-over
  fee: number;                   // standard fee (= current fee for A/C)
  contributionDelta: number;     // objective value vs current
  netShippingProfitDelta: number;
  upliftMarginGain: number;      // 0 for A/B
  abandonMarginLoss: number;
  freeOrderShare: number;        // 0..1
  recoveryRate: number;
  expectedOrdersLost: number;    // abandonment, in orders
  unconstrained: boolean;        // degeneracy guard tripped
}
```

## UI — v2 comparison report (revised 2026-06-10 after Damo feedback; supersedes the v1 Apply-card design below)

Step 4 is a **comparison report**, not a pick-one proposal. Damo's direction: "We should be having a side by side comparison against the 3 showing the value and impacts… the report should give all information based on the 3 options."

`components/simulator/OptionsComparison.tsx` replaces `RecommendationCards.tsx`:

- **Assumptions panel** — unchanged from v1 (COGS %, uplift %, uplift window $, abandonment % sliders; `no-print`; COGS gates the report).
- **Comparison table** — columns **Current | Profit-first | Optimised threshold + fee | Basket-builder | Custom**. Rows: standard-tier scheme summary (free-over + fee), Δ total contribution, Δ net shipping profit, basket margin gain, abandonment margin loss, expected orders lost, free-order share, cost recovery, and (when monthly volume is set) the illustrative monthly/annual Δ scaled the same way BenchmarkPanel does. The Current column shows the deterministic observed baseline (no behaviour applied); option columns are expected-value metrics vs that baseline. Unconstrained optima are marked in their column. Assumption echo line printed beneath the table.
- **Custom column** — driven by the existing manual tier inputs (which stay, below the table, `no-print` as today). Evaluated with the same behavioural model via a new pure `evaluateScheme()` so it is directly comparable. Starts seeded = current scheme (all-zero deltas) until edited.
- **Drill-down tabs** (`no-print` for the tab strip) — Profit-first / Optimised / Basket-builder / Custom. The selected option's scheme feeds the EXISTING full analysis (`analyze()` → BenchmarkPanel: verdict, recovery gauges, profit bridge, mix shift, movement, sweep, findings). A printed caption notes the drill-down is the structural comparison at observed carts — behaviour assumptions apply to the table, not these charts.
- **No Apply button / no applied state.** The PDF export = assumptions echo + comparison table + the selected option's full analysis.

Engine addition: `evaluateScheme(orders, current, candidate, behavior)` exported from `lib/shipping-sim/recommend.ts` — same metric bundle as a `RecommendedScheme` (deltas, margin effects, shares) for an arbitrary candidate scheme; used for the Custom column. Step-4 computation (recommendations, per-option analysis) moves from the wizard into `StepProposal`, which already receives the raw materials.

Brand: existing `tac-*` tokens, consistent with the rest of the analysis panel.

## Reporting under the table — v3 comparative report (revised 2026-06-10 after Damo feedback; supersedes the v2 drill-down)

Damo: "all the reporting under the table needs to be redone, it doesn't make sense anymore." The v2 drill-down was the old current-vs-proposed report: "proposal" language, one option at a time, and behaviour-free numbers that contradicted the table above it. Decisions: **comparative sections** (every section covers all options at once, no tabs) and **behaviour-consistent numbers everywhere** (the same expected-value model as the table; the mechanical no-behaviour view disappears).

### Engine additions (`lib/shipping-sim/`, TDD)

- `BehavioralResult` gains EV-weighted order-impact counts: `impact: { newlyPaying, newlyFree, builders, switchedTier }` (abandoners already exist as `expectedOrdersLost`). "Newly paying/free" compare the order's candidate shipping fee against its current fee; builders = basket-building weight; switchedTier = weight landing on a different tier than chosen.
- `SchemeEvaluation` gains the absolutes `shippingRevenue`, `carrierSpend`, `netShippingProfit` and the `impact` counts, so the report can decompose contribution without re-deriving anything.
- New `thresholdCurves(orders, current, behavior)`: for each numeric threshold candidate (standard fee held at current), the contribution delta with uplift off and with uplift on — `{ threshold, contributionNoUplift, contributionWithUplift }[]`. Powers the sensitivity chart.

### Report sections (`components/simulator/ComparisonReport.tsx`, replaces BenchmarkPanel)

Rendered directly under the comparison table; the whole report is printable and the PDF-export button moves here. Sections, in order:

1. **Reconciliation badge** — reuse `ReconciliationBadge`; reconciliation computed from Σ `shippingPaid` vs the Current column's deterministic revenue (no `analyze()` needed).
2. **Headline verdict** — one narrative card: the option with the highest Δ total contribution, its expected cost (orders lost, free-share shift), and the runner-up trade-off. Custom included when it differs from current.
3. **Contribution decomposition chart** — stacked bar per option: Δ shipping fee revenue, Δ carrier spend (sign-flipped so savings stack positive), basket margin gain, abandonment margin loss (negative); the stack nets to Δ total contribution.
4. **Recovery & free-share comparison** — grouped bars across Current + options: cost recovery %, free-order share %.
5. **Order impact table** — rows: Newly paying, Newly free, Build baskets, Switch tier, Abandon (expected, 1dp); columns: the options. EV-weighted counts from `impact`.
6. **AOV distribution** — reuse `AovDistribution` (prop changed from `movement` to plain gross values since `analyze()` is no longer in the path), markers for the current threshold and each option's threshold.
7. **Threshold sensitivity** — line chart of contribution vs standard free-over threshold from `thresholdCurves`: one line without basket-building, one with; reference lines at current + each option's threshold.
8. **Findings** — comparative bullets (which option wins and why, where the money comes from, what it risks, illustrative monthly/annual scaling when volume is set) with the assumption echo.

### Removals

- `BenchmarkPanel.tsx` and its single-option children (`VerdictHeader`, `ProfitBridge`, `RecoveryGauges`, `TierEconomicsTable`, `MovementTable`, `CarrierMixChart`, `ThresholdSweepChart`, `Findings`) are deleted. `ReconciliationBadge`, `AovDistribution`, `format.ts` survive.
- The drill-down tab strip, `selected`/`activeKey` state, and `analyze()` usage in StepProposal go away. `lib/shipping-sim/analysis.ts` stays (tested, used by nothing in the UI — candidate for later cleanup).
- Pre-COGS, the report shows only the reconciliation badge plus the COGS prompt (no option data exists to report on).

## v3.1 amendments (2026-06-10, after Damo's first real-data run)

Real 525-order dataset surfaced three issues:

1. **Flat abandonment is degenerate.** With a $30 fee, "Optimised" recommended $60 flat (+$3,029) — pinned at the fee sweep cap, because 10% of worse-off orders abandon regardless of how much worse off they are, so charging more almost always wins. **Fix: magnitude-scaled abandonment.** `abandonRate` now means *share abandoning per $10 of shipping-cost increase*, capped at 100%: `abandonProb = min(1, abandonRate × (landedFee − currentFee) / 10)` when the increase is positive. Slider label/tooltip/echo updated accordingly. Existing $10-increase fixtures keep their expected values by construction.
2. **Express invisible.** The comparison table only summarised the standard tier. Fix: one scheme-summary row per used tier — recommendations leave non-standard tiers at current (shown as such); Custom shows its own per-tier config.
3. **No volume split / cost shift.** Engine: `BehavioralResult` (and `SchemeEvaluation`) gain `volumeByTier` and `carrierSpendByTier` (EV-weighted, by landed tier, completing orders). Comparison table gains per-used-tier volume rows (count + share of completing) and a carrier-spend row (absolute for Current, absolute + signed Δ for options). Report gains a **Tier volume mix** grouped-bar section (Current + options × used tiers) between the order-impact table and the AOV distribution.

The comparison table is now driven by the same per-option `ReportOption`/`SchemeEvaluation` data as the report (single source), replacing its direct use of `RecommendedScheme` metrics.

4. **Sections are confusing without context** (Damo: "can you explain each section better"). Every report section and the comparison table open with a one-to-two-sentence plain-English explainer — what the section shows, how to read it, what to look for — in muted text that PRINTS (the client reads the PDF without us in the room). Comparison-table metric rows get a tooltip (ⓘ title) defining each metric in plain words. Explainers must describe the reader's decision, not the implementation ("Which option makes the most money after customers react" — not "EV-weighted contribution delta").

**5. Revealed-preference guard on uplift.** Basket-building only applies where the candidate creates a NEW window — orders already within the uplift window of their current tier's threshold demonstrably didn't build, so they're excluded. Guarantees evaluating the current scheme against itself is a strict no-op under any behaviour settings.

## v3.2 — dominant-tier optimisation + no-op badges (2026-06-10, after Damo's second real-data run)

Real data: 80% of orders ship express at $60 flat; standard (the only tier the optimizer touched) is mostly free already and genuinely sits at a local optimum — so all three recommendations resolved to the current scheme and every column was identical, with no explanation in the table. Decisions:

1. **Optimize the dominant paid tier.** The three sweeps target whichever used tier has the most PAID orders under the current scheme (`dominantPaidTier()` — most orders with `currentFee > 0`; tie or all-free falls back to most total volume, then canonical order). All sweep mechanics are unchanged, just applied to that tier's fee/threshold; other tiers stay at current. `RecommendedScheme` gains `tier: CanonicalTier`. `thresholdCurves` sweeps the same tier. The UI states which service the recommendations re-price (table explainer, footnote, sensitivity caption, AOV markers); the old "no standard tier" edge becomes "no analysable paid tier".
2. **No-op badge.** When an option's recommended config equals the current scheme's config for the optimised tier, its column header shows an "= current" badge (title: already optimal under these assumptions) and the scheme row reads as unchanged. The verdict's keep-current branch continues to carry the narrative.

## v4 — buying-behaviour redesign (2026-06-12, per Damo's first-principles rethink)

Damo's direction, restated: Option 1 must improve **net profit** through two engines — maximising shipping revenue AND shifting freight from express to standard (carrier saving). Basket-building must read the **complete order range** and place thresholds at the price point that drives **one additional unit**, based on the AOV/unit data in the Shopify export — and that applies to free-express thresholds too ("if free express is selected above a certain value, that value should be driving another unit"). Orders go into behaviour **buckets** that visibly shift under each option. Custom becomes **Competitor benchmark** (enter a competitor's scheme; highlight that the comparison assumes comparable RRP).

### Option lineup (replaces Profit-first / Optimised / Basket-builder)

1. **Net profit maximiser** — sweeps levers across BOTH paid tiers: standard threshold × standard fee × express fee (express threshold drawn from the unit-driven candidate set below, plus flat). Objective: expected total contribution. The report explicitly narrates the freight shift: orders moved express→standard and the carrier saving, alongside fee-revenue recovery. Grid is bounded coarse-to-fine to stay interactive (target <500ms typical; budget documented in the plan).
2. **Basket-builder (unit-driven)** — threshold candidates are derived from the data, not assumed: (a) order-value clusters from a $10-bin histogram of gross; (b) **typical unit price** = quantity-weighted median line-item price (full export) — candidates = cluster edge + one typical unit, rounded to $5, generated for standard AND express free-over lines. The uplift window defaults to the typical unit price ("orders within one unit of the threshold add a unit"); the uplift-rate slider stays as the tunable share. Recommendation copy names the cluster and the unit: "Free over $X — your $140–$170 orders add one ~$45 unit to qualify." Without line items it falls back to today's slider-driven sweep.
3. **Competitor benchmark** — the manual column, renamed; intro copy: "Enter a competitor's shipping scheme to see what matching it would do. Assumes your product pricing (RRP) is comparable — if their RRP differs, the comparison is not like-for-like." (printed).

### Buying-behaviour buckets

Auto-derived segments, computed per option: item count (1 / 2 / 3+) × position vs the option's relevant threshold (well below / within one unit / at-or-above) × chosen service. A new report section lists each bucket (name, orders, value share) and where it lands under each option (pays / free / builds / switches service / abandons — EV-weighted). This subsumes the order-impact table as the primary "what moves" story; buckets are the unit of explanation in findings and verdict.

### Parser — dual mode

- **Full Shopify orders export** (detected by `Name` + `Lineitem quantity` + `Lineitem price` columns): rows grouped by order Name; order gross/shipping/method from the order-level row; `units` = Σ line-item quantities; line-item prices feed the unit-price distribution. Unlocks unit-driven thresholds and item-count buckets.
- **Summary CSV** (current 3 columns): keeps working; unit-driven features fall back to sliders; buckets degrade to value-position × service.
- `OrderRow` gains optional `units?: number`; a new `UnitStats` (typical unit price, units/order distribution) flows into the engine.

### Out of scope for v4

- Conversion-gain lever for price decreases (raised 2026-06-10, still open — revisit after v4).
- Multi-market/currency handling; per-item express surcharges (the "after the 3rd item" idea resolved to unit-driving thresholds instead).

### v1 UI (superseded, kept for history)

Three cards with one-click Apply writing into the proposal inputs; "applied" state on the matching card. Replaced because applying mutated the single report instead of presenting the three options side by side.

## Testing

- Strict TDD on `recommend.ts`: uplift branch math, abandonment branch math, combined weighting, null-threshold candidate, objective reduces to existing sweep when behaviour is zeroed, ranking picks argmax, bucketing equivalence, degeneracy flag.
- UI verified by `npm run build` + manual dev-server QA (project convention — no component-test infra).
- Branch: `feat/simulator-recommendations`; no merge to `main` (auto-deploys) without explicit sign-off.

## Edge cases

- No standard tier in the current scheme → no cards; section explains why (recommendations target the standard free-over line).
- COGS unset → cards replaced by a prompt to enter COGS %.
- All orders already free under every candidate → cards render with zero deltas; no crash.
- `abandonRate = 0` and optimum at range edge → `unconstrained: true`, warning shown.
- Flat current scheme (no threshold today) → `currentFee` is the flat fee; model handles it without special cases.

## Out of scope

- Multi-tier / express-premium optimisation (revisit after this ships).
- Deriving uplift propensity from order bunching in the data.
- Persistence of assumptions between sessions.
- Conversion-rate effects beyond the abandonment lever (no traffic modelling).
