---
title: Shipping Strategy Simulator Design
date: 2026-06-03
tags: [claude]
project: personal
status: active
type: note
---

# Shipping Strategy Simulator — Rebuild Design

**Date:** 2026-06-03
**Status:** Approved (design) — pending implementation plan
**Author:** Jarvis (with Damo)
**Supersedes:** the current single-threshold simulator at `app/simulator/page.tsx`

---

## 1. Purpose

Rebuild the Shipping Strategy Simulator from a single-threshold, flat-cost model
into a **multi-tier shipping model** that uses a merchant's real Shopify order
data to:

1. Reconstruct their **current** shipping economics (fees, free-over thresholds,
   carrier cost) from the service each customer actually selected at checkout.
2. Let a consultant **propose** new fees/thresholds per tier and **project** how
   orders shift between tiers, using a behavioural model grounded entirely in
   revealed customer behaviour (no invented elasticity numbers).
3. **Benchmark current vs proposed** on the two levers that actually move:
   **shipping revenue collected** and **carrier spend** — then the net profit
   impact, with COGS% as optional context.

This is a client-facing consulting tool. Defensibility of the projection matters
more than sophistication — every number must trace back to uploaded data or a
single visible, tunable assumption.

---

## 2. Canonical tiers

A fixed set of four canonical service tiers, plus an exclude option:

- **Standard**
- **Express**
- **NextDay**
- **SameDay**
- **Exclude** (service strings that should not be modelled, e.g. "Local pickup")

Every distinct checkout service string in the upload is mapped to exactly one of
these. Only tiers that have ≥1 mapped order are configured and shown downstream.

---

## 3. Data model

```ts
type CanonicalTier = 'standard' | 'express' | 'nextday' | 'sameday';

interface OrderRow {
  gross: number;          // gross sale / cart value (the AOV driver)
  shippingPaid: number;   // shipping actually paid at checkout (ground truth)
  rawService: string;     // service string as it appears in the CSV
}

interface TaggedOrder extends OrderRow {
  tier: CanonicalTier;    // rawService mapped to a canonical tier
}

interface TierConfig {
  tier: CanonicalTier;
  fee: number;            // charged when below threshold
  freeThreshold: number | null; // free at/above this cart value; null = flat (fee always applies)
  avgCost: number;        // carrier cost per order for this tier (entered in step 2)
}

type Scheme = Record<CanonicalTier, TierConfig>; // only used tiers present

interface ScenarioResult {
  shippingRevenue: number;                 // Σ cost(landedTier, gross)
  carrierSpend: number;                    // Σ avgCost(landedTier)
  tierMix: Record<CanonicalTier, number>;  // order count per tier after landing
  ordersByTier: Record<CanonicalTier, number>;
  netShippingProfit: number;               // shippingRevenue − carrierSpend
}

interface Benchmark {
  current: ScenarioResult;
  proposed: ScenarioResult;
  shippingRevenueDelta: number;
  carrierSpendDelta: number;
  netProfitDelta: number;                  // shippingRevenueDelta − carrierSpendDelta
  reconciliation: {                        // honesty check vs actual data
    actualShippingPaid: number;            // Σ shippingPaid from CSV
    modelledCurrentRevenue: number;        // current.shippingRevenue
    variancePct: number;                   // |modelled − actual| / actual
  };
  cogsContext?: {                          // optional, only if COGS% entered
    cogsPercent: number;
    grossProductMargin: number;            // identical both scenarios; context only
  };
}
```

---

## 4. The calculation model (the heart)

Fully deterministic. No random sampling. No elasticity guesses.

### 4.1 Cost of a tier for a cart

```
cost(tier, gross) =
  (tier.freeThreshold !== null && gross >= tier.freeThreshold) ? 0 : tier.fee
```

A `null` freeThreshold means the fee **always** applies (flat-rate tier — e.g.
express is always $15).

### 4.2 Revealed willingness-to-pay (the anchor)

Under the **current** scheme, for each order compute how much extra the customer
paid over the cheapest option available to them — the speed premium they
*revealed* they were willing to pay:

```
premium_revealed(order) = cost(chosenTier, gross) − min over usedTiers cost(tier, gross)
```

- Chose the cheapest available tier → `premium_revealed = 0` (no speed preference).
- Paid $15 over the cheapest option → `premium_revealed = 15`.

### 4.3 Where an order lands under the proposed scheme

```
cheapestProposed   = min over usedTiers cost(tier, gross)         // proposed scheme
stayPremium        = cost(chosenTier, gross) − cheapestProposed   // proposed scheme

if stayPremium <= premium_revealed:
    landedTier = chosenTier        // keep their tier; fee recomputed under proposal
else:
    landedTier = cheapestProposedTier   // unwilling to pay more → drop to cheapest (usually standard)
```

This deliberately avoids needing an explicit speed ranking between Express /
NextDay / SameDay — it operates purely on the cost premium customers revealed
they would pay. It naturally reproduces the target behaviour: an express buyer
who paid a $15 premium moves to standard once the proposed express premium
exceeds $15.

**Binary landing rule:** an order either keeps its chosen tier or falls to the
cheapest proposed tier. We do not model partial moves to intermediate tiers —
documented simplification, keeps the projection legible.

### 4.4 The two levers (headline output)

- **Shipping revenue collected** = `Σ cost(landedTier, gross)`, computed for the
  current scheme *and* the proposed scheme (model-to-model, apples-to-apples).
- **Carrier spend** = `Σ avgCost(landedTier)`. Current uses each order's actual
  chosen tier; proposed uses the post-shift landed tier.
- **Net profit Δ** = `(proposed.shippingRevenue − current.shippingRevenue)
  − (proposed.carrierSpend − current.carrierSpend)`.

### 4.5 COGS (optional context only)

Gross sale per order is identical in both scenarios (we change shipping pricing
and tier choice, never cart size), so **product COGS cancels out of the delta**.
COGS% is an optional input that powers an absolute full-margin context panel; it
does **not** change the headline profit delta. The UI must state this so nobody
reads COGS as a driver of the swing.

### 4.6 Reconciliation (honesty check)

The CSV contains *actual* shipping paid. We compare `Σ shippingPaid` (actual)
against the current-scheme **modelled** shipping revenue and surface the variance
as a badge. High variance ⇒ the entered current scheme doesn't match reality, so
the proposal can't be trusted yet — the UI says so before showing the benchmark.

---

## 5. The 4-step wizard (UX)

Stepped wizard with Next/Back; each step gated until the previous is valid.

| Step | Does | Gate to advance |
|---|---|---|
| **1 · Upload** | Parse Shopify CSV → `gross sale`, `shipping paid`, `service at checkout`. Show row count + parse warnings/errors. | ≥1 valid order; 3 required columns present |
| **2 · Map services** | List every distinct checkout service string. Assign each → Standard / Express / NextDay / SameDay / Exclude. Enter avg carrier cost/order per used tier. | Every service mapped; avg cost entered for each used tier |
| **3 · Current state** | Per used tier: enter `fee` + `freeThreshold` (or mark **flat** = no threshold). Live readout: orders per tier, % of total orders, % of total shipping revenue, reconciliation badge. | Config valid (fee ≥ 0; threshold ≥ 0 or flat) |
| **4 · Proposal** | Editable fee/threshold per tier (+ flat toggle). Live benchmark: current vs proposed shipping revenue, carrier spend, net profit Δ, tier-mix shift (before/after bars), profit-by-tier. Optional COGS% context panel. | — (terminal step) |

---

## 6. Architecture & files

Split the current 704-line monolith into focused units.

```
app/simulator/page.tsx                      thin — renders the wizard
components/simulator/
  ShippingSimulatorWizard.tsx               step state machine + validation gates
  steps/StepUpload.tsx
  steps/StepMapServices.tsx
  steps/StepCurrentScheme.tsx
  steps/StepProposal.tsx
  BenchmarkPanel.tsx                         current-vs-proposed results + charts
  TierConfigRow.tsx                          fee / threshold / flat toggle (reused in steps 3 + 4)
lib/shipping-sim/
  types.ts                                   Order, TierConfig, Scheme, ScenarioResult, Benchmark
  tiers.ts                                   canonical tier metadata, cost(), cheapest helpers
  model.ts                                   revealed-WTP simulation — PURE, unit-tested
  __tests__/model.test.ts                    coverage on the high-risk logic
```

- Reuse existing shared components: `CsvUploader`, `InputField`, `MetricCard`,
  recharts, and `formatCurrency` / `formatPercent` / `formatNumber` from
  `lib/calculations`.
- `lib/shipping-sim/model.ts` is **pure (no React, no side effects)** and built
  test-first — it is the part most prone to subtle error.

### Data flow

```
CSV text
  → parse (gross, shippingPaid, rawService) + validate columns
  → service map (rawService → CanonicalTier | exclude)
  → TaggedOrder[]
  → current Scheme (step 3) ──┐
  → proposed Scheme (step 4) ─┤
                              → model.simulate(orders, currentScheme, proposedScheme, cogs?)
                              → Benchmark
  → BenchmarkPanel render
```

---

## 7. Error handling & edge cases

- **Missing required columns** (gross sale / shipping paid / service) → block at
  step 1 with explicit per-column errors.
- **Unmapped services** → cannot advance past step 2; banner lists what's left.
- **A used tier with no avg cost** → blocked at step 2.
- **Empty / single-tier merchants** → model must work with 1 used tier (no
  switching possible; revenue/cost recompute only).
- **All-flat schemes** (every tier `freeThreshold = null`) → valid; thresholds
  simply never trigger free shipping.
- **Division-by-zero guards** on every % (orders, revenue, reconciliation variance).
- **Negative / non-numeric CSV cells** → coerced with a counted warning, not a crash.

---

## 8. Testing

- `lib/shipping-sim/model.ts` is built **test-first** (TDD), targeting the
  project's 80% minimum on the module.
- Required cases: revealed-premium computation; binary tier landing (stay vs drop);
  flat-rate (null threshold); single used tier; all-free scheme; all-flat scheme;
  reconciliation variance; COGS context isolation (delta unchanged by COGS%).
- Manual QA: run a real Shopify export through all 4 steps in the PM2 dev server
  (`client-intelligence`, :3001) before merge.

---

## 9. Scope decisions

**In scope**
- 4-step wizard, multi-tier model, revealed-WTP simulation, current-vs-proposed
  benchmark, reconciliation badge, optional COGS context.

**Explicitly dropped**
- The old single-threshold model, the random `computeScenario`, and the
  elasticity / threshold-seeking AOV-uplift inputs — the deterministic
  revealed-WTP rational model replaces them.
- `lib/calculations.ts` Module-3 (retention/EBIT) code is **left untouched** —
  it's used by other pages (`/retention`).

**Out of scope (possible follow-ups)**
- Wiring to tenant DB / the service-alias mapping shipped 2026-06-03 (this stays
  standalone CSV upload, matching "customer uploads their report").
- App-wide palette migration to the real TAC teal/blue/tiger brand. This page
  keeps the existing navy/orange tokens for consistency; a rebrand is a separate,
  app-wide task and should not be bolted onto this page.
- Persisting/exporting results or feeding the `/report` page (current sim writes
  to localStorage; we can revisit a clean export later).

---

## 10. Open question carried into planning

- Whether to keep any lightweight results persistence (localStorage handoff) for
  continuity with the existing `/report` page, or ship the rebuild with no
  persistence and add a proper export later. Defaulting to **no persistence** in
  the rebuild unless flagged.