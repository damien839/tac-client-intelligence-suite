---
title: Simulator Threshold Recommendations
date: 2026-06-10
tags: [claude]
project: tac
status: active
type: note
---

# Simulator Threshold Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Recommended schemes" section to Step 4 of the shipping simulator — three option cards (Profit-first / Optimised threshold + fee / Basket-builder) computed by a new pure recommendation engine with tunable basket-building and abandonment behaviour, each with one-click Apply.

**Architecture:** A new pure module `lib/shipping-sim/recommend.ts` buckets orders by (tier, gross), evaluates candidate schemes under an expected-value behavioural model (basket uplift + abandonment on top of the existing revealed-WTP landing), and sweeps the standard tier's threshold (and fee, for option B) to find each card's optimum. A new `RecommendationCards` component renders the cards + assumption sliders at the top of `StepProposal`; Apply writes into the wizard's existing `proposedTiers` state. Spec: `docs/superpowers/specs/2026-06-10-simulator-threshold-recommendations-design.md`.

**Tech Stack:** Next.js 14 (client components), TypeScript strict, Vitest (already wired: `npm test`), Tailwind `tac-*` tokens, existing shared components (`InputField`) and formatters (`lib/calculations`).

**Branch:** Work on `feat/simulator-recommendations` — **do NOT commit to `main`** (main auto-deploys to the client-facing Vercel site).

---

## File Structure

```
lib/shipping-sim/
  types.ts                       MODIFY — add BehaviorParams, OrderBucket, BehavioralResult, RecommendedScheme
  recommend.ts                   CREATE — bucketOrders, prepareBuckets, behavioralScenario, thresholdCandidates, recommendOptions  [pure, tested]
  __tests__/recommend.test.ts    CREATE — strict TDD
components/simulator/
  RecommendationCards.tsx        CREATE — assumptions panel + 3 cards + Apply
  steps/StepProposal.tsx         MODIFY — render RecommendationCards, new orders/onApply props
  ShippingSimulatorWizard.tsx    MODIFY — pass orders + onApply to StepProposal
```

Existing model code (`model.ts`, `tiers.ts`, `analysis.ts`) is reused, not modified.

---

## Task 0: Branch

**Files:** none

- [ ] **Step 1: Create the working branch from up-to-date main**

```bash
cd ~/projects/tac/client-intelligence
git checkout main && git pull && git checkout -b feat/simulator-recommendations
```

- [ ] **Step 2: Confirm the test runner works**

Run: `npm test`
Expected: existing `tiers/model/parse/analysis` suites PASS.

---

## Task 1: Types + bucketOrders

**Files:**
- Modify: `lib/shipping-sim/types.ts` (append to end)
- Create: `lib/shipping-sim/recommend.ts`
- Test: `lib/shipping-sim/__tests__/recommend.test.ts`

- [ ] **Step 1: Append the new shared types to `lib/shipping-sim/types.ts`**

```ts
/** Tunable behavioural assumptions driving the recommendation engine. */
export interface BehaviorParams {
  cogsPercent: number; // 0..1 — required to value product-margin effects
  upliftRate: number; // 0..1 — share of in-window orders that build baskets to the threshold
  upliftWindow: number; // $ — "in window" = within this much below the landed tier's threshold
  abandonRate: number; // 0..1 — share of worse-off orders (shipping cost rose vs current) that abandon
}

/** Orders grouped by identical behaviour under the model. */
export interface OrderBucket {
  tier: CanonicalTier;
  gross: number;
  count: number;
}

/** Expected-value outcome of one candidate scheme under the behavioural model. */
export interface BehavioralResult {
  shippingRevenue: number;
  carrierSpend: number;
  netShippingProfit: number; // shippingRevenue - carrierSpend
  upliftMarginGain: number; // product margin added by basket-building
  abandonMarginLoss: number; // product margin lost to abandonment
  expectedOrdersLost: number; // abandonment, in (fractional) orders
  freeOrderShare: number; // 0..1 of completing orders that ship free
  recoveryRate: number; // shippingRevenue / carrierSpend (0 when spend is 0)
}

export type RecommendationId = "profit-first" | "threshold-fee" | "basket-builder";

/** One recommendation card. */
export interface RecommendedScheme {
  id: RecommendationId;
  label: string;
  threshold: number | null; // recommended standard free-over (null = flat)
  fee: number; // standard fee (= current fee for profit-first / basket-builder)
  contributionDelta: number; // objective: shipping P&L delta + margin effects, vs current
  netShippingProfitDelta: number;
  upliftMarginGain: number; // 0 for profit-first / threshold-fee
  abandonMarginLoss: number;
  freeOrderShare: number;
  recoveryRate: number;
  expectedOrdersLost: number;
  unconstrained: boolean; // degeneracy guard tripped — see recommend.ts
}
```

- [ ] **Step 2: Write the failing test for `bucketOrders`**

Create `lib/shipping-sim/__tests__/recommend.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { bucketOrders } from "@/lib/shipping-sim/recommend";
import { CanonicalTier, TaggedOrder } from "@/lib/shipping-sim/types";

function o(gross: number, tier: CanonicalTier): TaggedOrder {
  return { gross, shippingPaid: 0, rawService: "x", tier };
}

describe("bucketOrders", () => {
  it("groups identical (tier, gross) orders", () => {
    const buckets = bucketOrders([o(80, "standard"), o(80, "standard"), o(120, "express")]);
    expect(buckets).toHaveLength(2);
    expect(buckets.find((b) => b.tier === "standard")).toEqual({
      tier: "standard",
      gross: 80,
      count: 2,
    });
    expect(buckets.find((b) => b.tier === "express")).toEqual({
      tier: "express",
      gross: 120,
      count: 1,
    });
  });

  it("rounds gross to the dollar when distinct buckets exceed the cap, preserving total count", () => {
    const orders = Array.from({ length: 5001 }, (_, i) => o(10 + i * 0.01, "standard"));
    const buckets = bucketOrders(orders);
    expect(buckets.length).toBeLessThan(200); // 10..60.01 rounds to ~51 distinct dollar values
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(5001);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `recommend.ts` module not found.

- [ ] **Step 4: Create `lib/shipping-sim/recommend.ts` with `bucketOrders`**

```ts
import { OrderBucket, TaggedOrder } from "./types";

/** Above this many distinct (tier, gross) pairs, gross is rounded to the dollar. */
const MAX_EXACT_BUCKETS = 5000;

/**
 * Group orders that behave identically under the model. Exact (tier, gross)
 * grouping first; falls back to dollar-rounded gross on pathological data so
 * sweep cost stays bounded.
 */
export function bucketOrders(orders: TaggedOrder[]): OrderBucket[] {
  const build = (round: boolean): OrderBucket[] => {
    const map = new Map<string, OrderBucket>();
    for (const order of orders) {
      const gross = round ? Math.round(order.gross) : order.gross;
      const key = `${order.tier}|${gross}`;
      const existing = map.get(key);
      map.set(
        key,
        existing
          ? { ...existing, count: existing.count + 1 }
          : { tier: order.tier, gross, count: 1 }
      );
    }
    return Array.from(map.values());
  };
  const exact = build(false);
  return exact.length > MAX_EXACT_BUCKETS ? build(true) : exact;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS — both `bucketOrders` cases green, existing suites untouched.

- [ ] **Step 6: Commit**

```bash
git add lib/shipping-sim/types.ts lib/shipping-sim/recommend.ts lib/shipping-sim/__tests__/recommend.test.ts
git commit -m "feat(simulator): recommendation types + order bucketing"
```

---

## Task 2: prepareBuckets + behavioralScenario

**Files:**
- Modify: `lib/shipping-sim/recommend.ts` (append)
- Test: `lib/shipping-sim/__tests__/recommend.test.ts` (append)

- [ ] **Step 1: Append failing tests**

Append to `recommend.test.ts` (extend the existing import from `@/lib/shipping-sim/recommend` rather than adding a duplicate import line):

```ts
import { prepareBuckets, behavioralScenario } from "@/lib/shipping-sim/recommend";
import { proposedScenario } from "@/lib/shipping-sim/model";
import { BehaviorParams, Scheme } from "@/lib/shipping-sim/types";

const current: Scheme = {
  standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 },
  express: { tier: "express", fee: 15, freeThreshold: 200, avgCost: 12 },
};

const ZERO: BehaviorParams = { cogsPercent: 0.4, upliftRate: 0, upliftWindow: 20, abandonRate: 0 };

describe("behavioralScenario", () => {
  it("reduces exactly to proposedScenario when behaviour is zeroed", () => {
    const orders = [
      o(80, "standard"),
      o(150, "standard"),
      o(150, "express"),
      o(250, "express"),
      o(80, "standard"),
    ];
    const candidate: Scheme = {
      standard: { tier: "standard", fee: 15, freeThreshold: 150, avgCost: 7 },
      express: { tier: "express", fee: 25, freeThreshold: 250, avgCost: 12 },
    };
    const prepared = prepareBuckets(bucketOrders(orders), current);
    const r = behavioralScenario(prepared, candidate, ZERO);
    const expected = proposedScenario(orders, current, candidate);
    expect(r.shippingRevenue).toBeCloseTo(expected.shippingRevenue);
    expect(r.carrierSpend).toBeCloseTo(expected.carrierSpend);
    expect(r.netShippingProfit).toBeCloseTo(expected.netShippingProfit);
    expect(r.upliftMarginGain).toBe(0);
    expect(r.abandonMarginLoss).toBe(0);
    expect(r.expectedOrdersLost).toBe(0);
  });

  it("applies basket-building uplift to in-window paying orders", () => {
    // gross 90, std fee 10 / free over 100, window 20 -> in window [80, 100).
    // uplift 0.5: half build (free, margin gain (100-90)*0.6), half pay $10. Not worse off -> no abandonment.
    const stdOnly: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 } };
    const prepared = prepareBuckets(bucketOrders([o(90, "standard")]), stdOnly);
    const r = behavioralScenario(prepared, stdOnly, {
      cogsPercent: 0.4,
      upliftRate: 0.5,
      upliftWindow: 20,
      abandonRate: 0,
    });
    expect(r.shippingRevenue).toBeCloseTo(5); // 0.5 * 10
    expect(r.carrierSpend).toBeCloseTo(7); // builders still ship
    expect(r.upliftMarginGain).toBeCloseTo(3); // 0.5 * 10 * (1 - 0.4)
    expect(r.freeOrderShare).toBeCloseTo(0.5);
    expect(r.expectedOrdersLost).toBe(0);
  });

  it("applies abandonment to worse-off orders", () => {
    // gross 80 currently pays $10; candidate raises std fee to $20 -> worse off.
    // abandon 0.25: quarter lost (margin loss 80*0.5), rest pay $20. Uplift off.
    const stdOnly: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 } };
    const candidate: Scheme = { standard: { tier: "standard", fee: 20, freeThreshold: 100, avgCost: 7 } };
    const prepared = prepareBuckets(bucketOrders([o(80, "standard")]), stdOnly);
    const r = behavioralScenario(prepared, candidate, {
      cogsPercent: 0.5,
      upliftRate: 0,
      upliftWindow: 20,
      abandonRate: 0.25,
    });
    expect(r.shippingRevenue).toBeCloseTo(15); // 0.75 * 20
    expect(r.carrierSpend).toBeCloseTo(5.25); // 0.75 * 7
    expect(r.abandonMarginLoss).toBeCloseTo(10); // 0.25 * 80 * 0.5
    expect(r.expectedOrdersLost).toBeCloseTo(0.25);
    expect(r.freeOrderShare).toBe(0);
  });

  it("splits weight build / abandon / pay for an in-window, worse-off order", () => {
    // gross 85, candidate fee 20 (worse than current 10), threshold 100, window 20 -> in window.
    // uplift 0.4 builds; of remaining 0.6, abandon 0.5 -> 0.3 abandons, 0.3 pays.
    const stdOnly: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 } };
    const candidate: Scheme = { standard: { tier: "standard", fee: 20, freeThreshold: 100, avgCost: 7 } };
    const prepared = prepareBuckets(bucketOrders([o(85, "standard")]), stdOnly);
    const r = behavioralScenario(prepared, candidate, {
      cogsPercent: 0,
      upliftRate: 0.4,
      upliftWindow: 20,
      abandonRate: 0.5,
    });
    expect(r.shippingRevenue).toBeCloseTo(6); // 0.3 * 20
    expect(r.carrierSpend).toBeCloseTo(4.9); // (0.4 + 0.3) * 7
    expect(r.upliftMarginGain).toBeCloseTo(6); // 0.4 * (100 - 85) * 1
    expect(r.abandonMarginLoss).toBeCloseTo(25.5); // 0.3 * 85 * 1
    expect(r.expectedOrdersLost).toBeCloseTo(0.3);
    expect(r.freeOrderShare).toBeCloseTo(0.4 / 0.7); // builders / completing
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `prepareBuckets`/`behavioralScenario` not exported.

- [ ] **Step 3: Append implementation to `recommend.ts`**

Add to the import block at the top (merge, don't duplicate):

```ts
import { revealedPremium } from "./model";
import { cheapestTier, tierCost } from "./tiers";
import {
  BehavioralResult,
  BehaviorParams,
  CanonicalTier,
  OrderBucket,
  Scheme,
  TaggedOrder,
} from "./types";
```

Then append:

```ts
/** A bucket enriched with candidate-independent facts about the current scheme. */
export interface PreparedBucket extends OrderBucket {
  currentFee: number; // shipping the bucket pays under the current scheme
  premium: number; // revealed WTP premium under the current scheme
}

/**
 * Precompute the candidate-independent half of the model once per recommendation
 * run; sweeps then only evaluate the candidate-dependent half per bucket.
 */
export function prepareBuckets(buckets: OrderBucket[], current: Scheme): PreparedBucket[] {
  return buckets.map((bucket) => {
    const order: TaggedOrder = {
      gross: bucket.gross,
      shippingPaid: 0,
      rawService: "",
      tier: bucket.tier,
    };
    return {
      ...bucket,
      currentFee: tierCost(current[bucket.tier]!, bucket.gross),
      premium: revealedPremium(order, current),
    };
  });
}

/**
 * Expected-value outcome of one candidate scheme. Per bucket:
 * 1. Land via revealed-WTP (same rule as landedTier, using the cached premium).
 * 2. Basket-building: in-window paying orders build to the threshold with
 *    weight upliftRate — ship free, carrier cost unchanged, gain product margin.
 * 3. Abandonment: of the remaining weight, worse-off orders (landed fee above
 *    current fee) abandon with weight abandonRate — lose product margin.
 * 4. The rest pay the landed fee.
 */
export function behavioralScenario(
  buckets: PreparedBucket[],
  candidate: Scheme,
  behavior: BehaviorParams
): BehavioralResult {
  const { cogsPercent, upliftRate, upliftWindow, abandonRate } = behavior;
  let shippingRevenue = 0;
  let carrierSpend = 0;
  let upliftMarginGain = 0;
  let abandonMarginLoss = 0;
  let expectedOrdersLost = 0;
  let freeOrders = 0;
  let completingOrders = 0;

  for (const bucket of buckets) {
    const cheapest = cheapestTier(candidate, bucket.gross);
    const chosen = candidate[bucket.tier];
    let landed: CanonicalTier;
    if (!chosen) {
      landed = cheapest.tier;
    } else {
      const stayPremium = tierCost(chosen, bucket.gross) - cheapest.cost;
      landed = stayPremium <= bucket.premium ? bucket.tier : cheapest.tier;
    }
    const landedConfig = candidate[landed]!;
    const landedFee = tierCost(landedConfig, bucket.gross);
    const threshold = landedConfig.freeThreshold;

    // landedFee > 0 with a non-null threshold implies gross < threshold.
    const inWindow =
      threshold !== null && landedFee > 0 && bucket.gross >= threshold - upliftWindow;
    const buildWeight = inWindow ? upliftRate : 0;
    const worseOff = landedFee > bucket.currentFee;
    const abandonWeight = worseOff ? (1 - buildWeight) * abandonRate : 0;
    const payWeight = 1 - buildWeight - abandonWeight;

    shippingRevenue += payWeight * landedFee * bucket.count;
    carrierSpend += (buildWeight + payWeight) * landedConfig.avgCost * bucket.count;
    if (buildWeight > 0) {
      upliftMarginGain += buildWeight * (threshold! - bucket.gross) * (1 - cogsPercent) * bucket.count;
    }
    abandonMarginLoss += abandonWeight * bucket.gross * (1 - cogsPercent) * bucket.count;
    expectedOrdersLost += abandonWeight * bucket.count;
    freeOrders += (buildWeight + (landedFee === 0 ? payWeight : 0)) * bucket.count;
    completingOrders += (buildWeight + payWeight) * bucket.count;
  }

  return {
    shippingRevenue,
    carrierSpend,
    netShippingProfit: shippingRevenue - carrierSpend,
    upliftMarginGain,
    abandonMarginLoss,
    expectedOrdersLost,
    freeOrderShare: completingOrders > 0 ? freeOrders / completingOrders : 0,
    recoveryRate: carrierSpend > 0 ? shippingRevenue / carrierSpend : 0,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all `behavioralScenario` cases green.

- [ ] **Step 5: Commit**

```bash
git add lib/shipping-sim/recommend.ts lib/shipping-sim/__tests__/recommend.test.ts
git commit -m "feat(simulator): behavioural scenario engine (uplift + abandonment)"
```

---

## Task 3: thresholdCandidates + recommendOptions

**Files:**
- Modify: `lib/shipping-sim/recommend.ts` (append)
- Test: `lib/shipping-sim/__tests__/recommend.test.ts` (append)

- [ ] **Step 1: Append failing tests**

Append to `recommend.test.ts` (again, merge imports):

```ts
import { recommendOptions, thresholdCandidates } from "@/lib/shipping-sim/recommend";
import { currentScenario } from "@/lib/shipping-sim/model";

describe("thresholdCandidates", () => {
  it("sweeps $0 to max(400, p95 rounded up to $10) in $10 steps, with null last", () => {
    const small = thresholdCandidates([o(50, "standard")]);
    expect(small[0]).toBe(0);
    expect(small[small.length - 1]).toBeNull();
    expect(small[small.length - 2]).toBe(400);
    expect(small).toContain(150); // $10 steps

    const big = thresholdCandidates(Array.from({ length: 20 }, () => o(950, "standard")));
    expect(big[big.length - 2]).toBe(950); // ceil(950/10)*10, above the 400 floor
  });

  it("caps the sweep at $1000", () => {
    const huge = thresholdCandidates(Array.from({ length: 20 }, () => o(5000, "standard")));
    expect(huge[huge.length - 2]).toBe(1000);
  });
});

describe("recommendOptions", () => {
  const behavior: BehaviorParams = {
    cogsPercent: 0.4,
    upliftRate: 0.3,
    upliftWindow: 20,
    abandonRate: 0,
  };

  it("returns [] when the current scheme has no standard tier", () => {
    const expressOnly: Scheme = {
      express: { tier: "express", fee: 15, freeThreshold: 200, avgCost: 12 },
    };
    expect(recommendOptions([o(80, "express")], expressOnly, behavior)).toEqual([]);
  });

  it("returns [] when there are no analysable orders", () => {
    expect(recommendOptions([], current, behavior)).toEqual([]);
  });

  it("profit-first matches a brute-force sweep of the same candidates (behaviour zeroed)", () => {
    const orders = [
      o(80, "standard"),
      o(150, "standard"),
      o(150, "express"),
      o(250, "express"),
      o(60, "standard"),
    ];
    const baseline = currentScenario(orders, current).netShippingProfit;
    let bestDelta = -Infinity;
    for (const t of thresholdCandidates(orders)) {
      const cand: Scheme = {
        ...current,
        standard: { ...current.standard!, freeThreshold: t },
      };
      const delta = proposedScenario(orders, current, cand).netShippingProfit - baseline;
      if (delta > bestDelta) bestDelta = delta;
    }
    const a = recommendOptions(orders, current, behavior).find((r) => r.id === "profit-first")!;
    // abandonRate 0 and uplift forced off for profit-first -> contribution = shipping delta
    expect(a.contributionDelta).toBeCloseTo(bestDelta);
    expect(a.upliftMarginGain).toBe(0);
  });

  it("computes the three cards on a single-tier fixture (hand-verified)", () => {
    // Current: std fee $10, free over $200, cost $7. One order, gross $185 (pays $10 today).
    const cur: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 200, avgCost: 7 } };
    const b: BehaviorParams = { cogsPercent: 0.2, upliftRate: 1, upliftWindow: 20, abandonRate: 0 };
    const recs = recommendOptions([o(185, "standard")], cur, b);
    const a = recs.find((r) => r.id === "profit-first")!;
    const tf = recs.find((r) => r.id === "threshold-fee")!;
    const bb = recs.find((r) => r.id === "basket-builder")!;

    // A (uplift off): any T <= 180 makes the order free (delta -10); T >= 190 keeps it
    // paying (delta 0). Ties prefer the lowest threshold -> 190. Charges everyone ->
    // unconstrained flag (abandonment 0).
    expect(a.threshold).toBe(190);
    expect(a.contributionDelta).toBeCloseTo(0);
    expect(a.unconstrained).toBe(true);

    // B: with no abandonment, revenue is monotone in fee -> pins at maxFee = max(2*10, 30) = 30.
    expect(tf.fee).toBe(30);
    expect(tf.threshold).toBe(190);
    expect(tf.contributionDelta).toBeCloseTo(20); // (30-7) - (10-7)
    expect(tf.unconstrained).toBe(true);

    // C (uplift on): at T=200 the order (in window [180,200)) builds: loses the $10 fee,
    // gains (200-185)*0.8 = $12 margin -> delta +2. Beats every paying candidate (0).
    expect(bb.threshold).toBe(200);
    expect(bb.contributionDelta).toBeCloseTo(2);
    expect(bb.upliftMarginGain).toBeCloseTo(12);
    expect(bb.unconstrained).toBe(false); // optimum is interior, threshold gives free shipping
  });

  it("does not flag unconstrained when abandonment is set", () => {
    const orders = [o(80, "standard"), o(150, "standard"), o(170, "standard")];
    const cur: Scheme = { standard: { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 } };
    const withAbandon: BehaviorParams = {
      cogsPercent: 0.5,
      upliftRate: 0,
      upliftWindow: 20,
      abandonRate: 0.5,
    };
    const a = recommendOptions(orders, cur, withAbandon).find((r) => r.id === "profit-first")!;
    expect(a.unconstrained).toBe(false);
    // T=100 (the current scheme) is always a candidate, so the optimum is never negative.
    expect(a.contributionDelta).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `thresholdCandidates`/`recommendOptions` not exported.

- [ ] **Step 3: Append implementation to `recommend.ts`**

Merge `RecommendationId` and `RecommendedScheme` into the existing `./types` import, then append:

```ts
const THRESHOLD_STEP = 10;
const THRESHOLD_FLOOR = 400; // always sweep at least this far
const THRESHOLD_CAP = 1000;
const FEE_STEP = 1;
const FEE_FLOOR = 30; // fee sweep upper bound: max(2x current fee, this)

/**
 * Candidate thresholds: $0..max($400, p95 of gross rounded up to $10), capped
 * at $1000, in $10 steps — plus null (flat, no free shipping) evaluated last so
 * ties prefer the lowest qualifying threshold.
 */
export function thresholdCandidates(orders: TaggedOrder[]): (number | null)[] {
  const sorted = orders.map((order) => order.gross).sort((a, b) => a - b);
  const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))] ?? 0;
  const maxThreshold = Math.min(
    THRESHOLD_CAP,
    Math.max(THRESHOLD_FLOOR, Math.ceil(p95 / THRESHOLD_STEP) * THRESHOLD_STEP)
  );
  const candidates: (number | null)[] = [];
  for (let t = 0; t <= maxThreshold; t += THRESHOLD_STEP) candidates.push(t);
  candidates.push(null);
  return candidates;
}

interface CandidateResult {
  threshold: number | null;
  fee: number;
  result: BehavioralResult;
  contributionDelta: number;
}

/**
 * Run the three recommendation sweeps over the standard tier.
 * - profit-first: threshold only, uplift forced off
 * - threshold-fee: threshold x fee grid, uplift forced off
 * - basket-builder: threshold only, uplift per the caller's params
 * Abandonment applies to all three. Objective: expected total contribution
 * delta vs the current scheme (shipping P&L + product-margin effects).
 */
export function recommendOptions(
  orders: TaggedOrder[],
  current: Scheme,
  behavior: BehaviorParams
): RecommendedScheme[] {
  const std = current.standard;
  if (!std) return [];
  const valid = orders.filter((order) => current[order.tier] !== undefined);
  if (valid.length === 0) return [];

  const prepared = prepareBuckets(bucketOrders(valid), current);
  const baselineNet = prepared.reduce(
    (sum, b) => sum + (b.currentFee - current[b.tier]!.avgCost) * b.count,
    0
  );
  const thresholds = thresholdCandidates(valid);
  const maxFee = Math.max(2 * std.fee, FEE_FLOOR);
  const noUplift: BehaviorParams = { ...behavior, upliftRate: 0 };

  const evalCandidate = (
    threshold: number | null,
    fee: number,
    params: BehaviorParams
  ): CandidateResult => {
    const candidate: Scheme = { ...current, standard: { ...std, fee, freeThreshold: threshold } };
    const result = behavioralScenario(prepared, candidate, params);
    return {
      threshold,
      fee,
      result,
      contributionDelta:
        result.netShippingProfit - baselineNet + result.upliftMarginGain - result.abandonMarginLoss,
    };
  };

  // Strict > keeps the earliest of tied candidates: lowest threshold, lowest fee.
  const best = (candidates: CandidateResult[]): CandidateResult =>
    candidates.reduce((acc, c) => (c.contributionDelta > acc.contributionDelta ? c : acc));

  const bestA = best(thresholds.map((t) => evalCandidate(t, std.fee, noUplift)));
  const grid: CandidateResult[] = [];
  for (let fee = 0; fee <= maxFee; fee += FEE_STEP) {
    for (const t of thresholds) grid.push(evalCandidate(t, fee, noUplift));
  }
  const bestB = best(grid);
  const bestC = best(thresholds.map((t) => evalCandidate(t, std.fee, behavior)));

  // Degeneracy guard: with abandonment off, nothing in the model punishes charging
  // more. Flag optima that charge everyone (no free shipping granted) or pin the
  // fee at the top of its range.
  const isUnconstrained = (c: CandidateResult, sweepsFee: boolean): boolean =>
    behavior.abandonRate === 0 &&
    (c.threshold === null || c.result.freeOrderShare === 0 || (sweepsFee && c.fee === maxFee));

  const toScheme = (
    id: RecommendationId,
    label: string,
    c: CandidateResult,
    sweepsFee: boolean
  ): RecommendedScheme => ({
    id,
    label,
    threshold: c.threshold,
    fee: c.fee,
    contributionDelta: c.contributionDelta,
    netShippingProfitDelta: c.result.netShippingProfit - baselineNet,
    upliftMarginGain: c.result.upliftMarginGain,
    abandonMarginLoss: c.result.abandonMarginLoss,
    freeOrderShare: c.result.freeOrderShare,
    recoveryRate: c.result.recoveryRate,
    expectedOrdersLost: c.result.expectedOrdersLost,
    unconstrained: isUnconstrained(c, sweepsFee),
  });

  return [
    toScheme("profit-first", "Profit-first", bestA, false),
    toScheme("threshold-fee", "Optimised threshold + fee", bestB, true),
    toScheme("basket-builder", "Basket-builder", bestC, false),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all recommend tests green (and everything else still green).

- [ ] **Step 5: Commit**

```bash
git add lib/shipping-sim/recommend.ts lib/shipping-sim/__tests__/recommend.test.ts
git commit -m "feat(simulator): three-card recommendation sweeps + degeneracy guard"
```

---

## Task 4: RecommendationCards component

**Files:**
- Create: `components/simulator/RecommendationCards.tsx`

No unit test (project convention: UI verified by build + manual QA).

- [ ] **Step 1: Create `components/simulator/RecommendationCards.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import InputField from "@/components/shared/InputField";
import { recommendOptions } from "@/lib/shipping-sim/recommend";
import {
  BehaviorParams,
  RecommendedScheme,
  Scheme,
  TaggedOrder,
} from "@/lib/shipping-sim/types";
import { formatCurrency, formatPercent } from "@/lib/calculations";

interface RecommendationCardsProps {
  orders: TaggedOrder[];
  currentScheme: Scheme;
  proposedStandard: { fee: number; freeThreshold: number | null } | undefined;
  cogsPercent: number | undefined;
  onCogsChange: (value: number | undefined) => void;
  onApply: (patch: { fee: number; freeThreshold: number | null }) => void;
}

function signedCurrency(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatCurrency(value)}`;
}

export default function RecommendationCards({
  orders,
  currentScheme,
  proposedStandard,
  cogsPercent,
  onCogsChange,
  onApply,
}: RecommendationCardsProps) {
  const [upliftRate, setUpliftRate] = useState(0.3);
  const [upliftWindow, setUpliftWindow] = useState(20);
  const [abandonRate, setAbandonRate] = useState(0.1);

  const recs = useMemo<RecommendedScheme[] | null>(() => {
    if (cogsPercent === undefined) return null;
    const behavior: BehaviorParams = { cogsPercent, upliftRate, upliftWindow, abandonRate };
    return recommendOptions(orders, currentScheme, behavior);
  }, [orders, currentScheme, cogsPercent, upliftRate, upliftWindow, abandonRate]);

  if (!currentScheme.standard) {
    return (
      <div className="card">
        <h3 className="text-lg font-semibold mb-2 text-tac-accent">Recommended schemes</h3>
        <p className="text-sm text-tac-muted">
          Recommendations target the standard free-over line — map a service to Standard to
          enable them.
        </p>
      </div>
    );
  }

  const assumptionLine = (rec: RecommendedScheme): string => {
    const abandon = `${Math.round(abandonRate * 100)}% of worse-off orders abandon`;
    const cogs = `COGS ${Math.round((cogsPercent ?? 0) * 100)}%`;
    if (rec.id === "basket-builder") {
      return `${Math.round(upliftRate * 100)}% of orders within $${upliftWindow} below the threshold build baskets; ${abandon}; ${cogs}`;
    }
    return `No basket-building assumed; ${abandon}; ${cogs}`;
  };

  const isApplied = (rec: RecommendedScheme): boolean =>
    proposedStandard !== undefined &&
    proposedStandard.fee === rec.fee &&
    proposedStandard.freeThreshold === rec.threshold;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-tac-accent">Recommended schemes</h3>

      {/* Assumptions panel — inputs hidden in print; each card echoes its assumptions */}
      <div className="card no-print">
        <p className="text-sm text-tac-muted mb-3">
          Behavioural assumptions. Every number below shows its inputs — drag these to
          stress-test the recommendations.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <InputField
            label="COGS %"
            value={(cogsPercent ?? 0) * 100}
            onChange={(v) => onCogsChange(v / 100)}
            suffix="%"
            step={1}
            min={0}
            max={100}
            tooltip="Required — values the product margin gained by basket-building and lost to abandonment"
          />
          <InputField
            label="Basket uplift"
            value={upliftRate * 100}
            onChange={(v) => setUpliftRate(v / 100)}
            suffix="%"
            step={5}
            min={0}
            max={100}
            tooltip="Share of orders just below the threshold that add items to qualify"
          />
          <InputField
            label="Uplift window"
            value={upliftWindow}
            onChange={setUpliftWindow}
            prefix="$"
            step={5}
            min={0}
            tooltip="How far below the threshold an order can be and still build to it"
          />
          <InputField
            label="Abandonment"
            value={abandonRate * 100}
            onChange={(v) => setAbandonRate(v / 100)}
            suffix="%"
            step={1}
            min={0}
            max={100}
            tooltip="Share of orders facing a higher shipping cost than today that abandon"
          />
        </div>
      </div>

      {cogsPercent === undefined ? (
        <div className="card">
          <p className="text-sm text-tac-warning">
            Enter a COGS % above to enable recommendations — without it, basket-building
            gains and abandonment losses can&apos;t be valued.
          </p>
        </div>
      ) : (
        recs &&
        recs.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {recs.map((rec) => (
              <div key={rec.id} className="card flex flex-col">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="font-semibold text-tac-accent">{rec.label}</h4>
                  {isApplied(rec) && (
                    <span className="text-xs text-tac-success">Applied ✓</span>
                  )}
                </div>
                <p className="text-xl font-bold text-tac-text">
                  {rec.threshold === null
                    ? "Flat rate — no free shipping"
                    : `Free over $${rec.threshold}`}
                </p>
                <p className="text-xs text-tac-muted mb-3">
                  Standard fee ${rec.fee}
                  {rec.id !== "threshold-fee" && " (unchanged)"}
                </p>

                <dl className="text-sm space-y-1 mb-3">
                  <div className="flex justify-between">
                    <dt className="text-tac-muted">Δ total contribution</dt>
                    <dd className="font-semibold text-tac-accent">
                      {signedCurrency(rec.contributionDelta)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-tac-muted">Δ net shipping profit</dt>
                    <dd>{signedCurrency(rec.netShippingProfitDelta)}</dd>
                  </div>
                  {rec.upliftMarginGain > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-tac-muted">Basket margin gain</dt>
                      <dd>{signedCurrency(rec.upliftMarginGain)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-tac-muted">Abandonment margin loss</dt>
                    <dd>{signedCurrency(-rec.abandonMarginLoss)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-tac-muted">Expected orders lost</dt>
                    <dd>{rec.expectedOrdersLost.toFixed(1)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-tac-muted">Free-order share</dt>
                    <dd>{formatPercent(rec.freeOrderShare)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-tac-muted">Cost recovery</dt>
                    <dd>{formatPercent(rec.recoveryRate)}</dd>
                  </div>
                </dl>

                <p className="text-xs text-tac-muted mb-3">{assumptionLine(rec)}</p>

                {rec.unconstrained && (
                  <p className="text-xs text-tac-warning mb-3">
                    Abandonment is 0% — nothing stops &quot;charge everyone more&quot;. Set an
                    abandonment rate before trusting this optimum.
                  </p>
                )}

                <button
                  className="btn-primary mt-auto no-print"
                  disabled={isApplied(rec)}
                  onClick={() => onApply({ fee: rec.fee, freeThreshold: rec.threshold })}
                >
                  {isApplied(rec) ? "Applied" : "Apply to proposal"}
                </button>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds (component unused so far but must type-check).

- [ ] **Step 3: Commit**

```bash
git add components/simulator/RecommendationCards.tsx
git commit -m "feat(simulator): recommendation cards + assumptions panel"
```

---

## Task 5: Wire into StepProposal and the wizard

**Files:**
- Modify: `components/simulator/steps/StepProposal.tsx`
- Modify: `components/simulator/ShippingSimulatorWizard.tsx:190-205` (StepProposal call site)

- [ ] **Step 1: Add the new props + render the cards in `StepProposal.tsx`**

Add to the imports:

```tsx
import RecommendationCards from "../RecommendationCards";
import { Analysis, CanonicalTier, Scheme, TaggedOrder } from "@/lib/shipping-sim/types";
```

(the `Analysis, CanonicalTier, Scheme` import line already exists — extend it with `TaggedOrder`.)

Extend the props interface with two new members:

```tsx
interface StepProposalProps {
  usedTiers: CanonicalTier[];
  tierVals: Partial<Record<CanonicalTier, { fee: number; freeThreshold: number | null }>>;
  cogsPercent: number | undefined;
  monthlyOrders: number | undefined;
  analysis: Analysis | null;
  currentScheme: Scheme;
  proposedScheme: Scheme;
  orders: TaggedOrder[];
  onChange: (tier: CanonicalTier, patch: { fee?: number; freeThreshold?: number | null }) => void;
  onCogsChange: (value: number | undefined) => void;
  onMonthlyOrdersChange: (value: number | undefined) => void;
  onApply: (patch: { fee: number; freeThreshold: number | null }) => void;
}
```

Destructure `orders` and `onApply` in the function signature alongside the existing props, then render the cards as the FIRST child inside the top-level `<div className="space-y-8">` (above the existing `no-print` tier-rows div — the cards section must NOT be inside a `no-print` wrapper so the cards land in the PDF):

```tsx
      <RecommendationCards
        orders={orders}
        currentScheme={currentScheme}
        proposedStandard={tierVals.standard}
        cogsPercent={cogsPercent}
        onCogsChange={onCogsChange}
        onApply={onApply}
      />
```

- [ ] **Step 2: Pass the new props from `ShippingSimulatorWizard.tsx`**

In the `step === 3` block, add two props to `<StepProposal ...>`:

```tsx
            orders={taggedOrders}
            onApply={(patch) => setProposedTiers((p) => ({ ...p, standard: patch }))}
```

- [ ] **Step 3: Build + full test suite**

Run: `npm run build && npm test`
Expected: build PASS, all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add components/simulator/steps/StepProposal.tsx components/simulator/ShippingSimulatorWizard.tsx
git commit -m "feat(simulator): wire recommendation cards into the proposal step"
```

---

## Task 6: Manual QA on the dev server

**Files:** none (verification only)

- [ ] **Step 1: Restart the dev server**

Run: `pm2 restart client-intelligence && pm2 logs client-intelligence --lines 5 --nostream`
Expected: compiles, serving on :3001. (If the process name differs, check `pm2 list`.)

- [ ] **Step 2: Walk the wizard at http://localhost:3001/simulator**

Verify in order:
- Steps 1–3 unchanged.
- Step 4: "Recommended schemes" renders above the tier rows. With COGS unset, the prompt shows instead of cards; setting COGS in the assumptions panel reveals three cards (and the existing full-margin context panel reflects the same COGS value).
- Profit-first and Optimised cards show "No basket-building assumed"; Basket-builder echoes the uplift sliders.
- Setting Abandonment to 0% trips the unconstrained warning on at least the Optimised card (fee pins at its range top); restoring 10% clears it.
- Dragging the uplift sliders changes the Basket-builder card only (A/B force uplift off) and stays responsive on a large CSV.
- Apply on a card fills the standard tier's fee/threshold inputs, the benchmark below recomputes, and the card flips to "Applied ✓" (disabled). Hand-editing the standard fee afterwards clears the applied state without changing the cards.
- PDF export (existing button in BenchmarkPanel) includes the cards with their assumption lines, but not the slider inputs or Apply buttons.

- [ ] **Step 3: Fix any defects via TDD**

If model behaviour diverges from the spec, write a failing test in `recommend.test.ts` first, fix in `recommend.ts`, then re-run `npm test && npm run build`.

---

## Task 7: Finish the branch

**Files:** none

- [ ] **Step 1: Final verification**

Run: `npm test && npm run build`
Expected: tests PASS, build PASS.

- [ ] **Step 2: Push the branch (does NOT deploy — not main)**

```bash
git push -u origin feat/simulator-recommendations
```

- [ ] **Step 3: Hand back to Damo**

Surface: branch pushed, tests/build green, dev server walked. Ask whether to merge to main (merge = live deploy to the client-facing site) — do not merge without explicit approval.

---

## Self-Review

**Spec coverage:**
- Three options A/B/C with levers/uplift/abandonment per the spec table → Task 3 `recommendOptions`. ✓
- Candidates built from the **current** scheme (cards stable vs proposal edits) → `evalCandidate` spreads `current`. ✓
- `null` (flat) candidate → `thresholdCandidates` appends null last; ties prefer lowest threshold. ✓
- BehaviorParams + per-order weighting (build / abandon / pay) and margin formulas → Task 2, matching spec §Behavioural model exactly. ✓
- Objective `contributionDelta` reduces to today's sweep with behaviour zeroed → Task 2 equivalence test + Task 3 brute-force test. ✓
- Degeneracy guard → `isUnconstrained` (freeOrderShare-0 form catches "charges everyone" optima that sit below the range edge; spec's intent, noted in code comment). ✓
- Sweep ranges (threshold $0..max(400, p95)→cap 1000 step 10; fee 0..max(2×fee,30) step 1) → Task 3 constants. ✓
- Bucketing + 5000 cap + equivalence test → Tasks 1–2. ✓
- UI: assumptions panel (no-print) + 3 cards with assumption echo, applied state, Apply patches standard tier only → Tasks 4–5. ✓
- Edge cases: no standard tier (explainer card / empty recs), COGS unset (prompt), empty orders ([]), flat current scheme (`currentFee` = flat fee — no special case), abandon-0 warning → Tasks 3–4. ✓
- Out of scope respected: no multi-tier optimisation, no persistence, no data-derived uplift. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; commands have expected output. ✓

**Type consistency:** `BehaviorParams`/`OrderBucket`/`BehavioralResult`/`RecommendedScheme` defined once in types.ts (Task 1) and used with identical shapes in Tasks 2–4. `PreparedBucket` exported from recommend.ts only. `recommendOptions(orders, current, behavior)` signature identical in Tasks 3 and 4. `onApply` patch shape `{fee, freeThreshold}` identical in Tasks 4 and 5. `proposedStandard` = `tierVals.standard` matches the wizard's `{ fee, freeThreshold }` tier-value shape. ✓
