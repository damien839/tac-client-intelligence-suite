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

## UI

`components/simulator/RecommendationCards.tsx`, rendered at the top of Step 4 (above the tier rows in `StepProposal`):

- **Assumptions panel** (compact card, `no-print` for the sliders but assumptions echoed as text on each card so the PDF shows them): COGS %, uplift %, uplift window $, abandonment %. Behaviour-param state is local to this component; COGS reuses the wizard's existing `cogsPercent` (the panel prompts for it when unset — cards don't compute without COGS).
- **Three cards**: label, recommended threshold (and fee for B), Δ total contribution, Δ net shipping profit, free-order share, recovery rate, expected orders lost; the formula/assumption line in small text ("30% of orders within $20 build; 10% of worse-off orders abandon; COGS 55%"). Numbers always shown with their inputs — never a bare estimate.
- **Apply button** per card: sets the proposal's standard-tier `fee`/`freeThreshold` to the card's values (other tiers untouched). The existing benchmark/analysis recomputes live as today. The card whose values match the current proposal inputs shows an "applied" state.

Wiring: `StepProposal` gains `orders: TaggedOrder[]` and an `onApply(patch)` prop from the wizard (wizard already holds `taggedOrders`, `currentScheme`, and the proposal setter).

Brand: existing `tac-*` tokens, consistent with the rest of the analysis panel.

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
