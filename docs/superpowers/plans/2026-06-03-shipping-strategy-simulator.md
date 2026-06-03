---
title: Shipping Strategy Simulator
date: 2026-06-03
tags: [claude]
project: personal
status: active
type: note
---

# Shipping Strategy Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/simulator` into a 4-step wizard that models multi-tier shipping economics from real Shopify data and benchmarks a proposed pricing scheme against current using a revealed-willingness-to-pay behavioural model.

**Architecture:** A pure, unit-tested model (`lib/shipping-sim/`) holds all calculation logic with zero React/IO dependencies. A wizard container (`components/simulator/`) drives four gated steps and feeds the model. The page (`app/simulator/page.tsx`) becomes a thin shell. Spec: `docs/superpowers/specs/2026-06-03-shipping-strategy-simulator-design.md`.

**Tech Stack:** Next.js 14 (App Router, client component), TypeScript strict, Vitest (new), Papa Parse (existing), Recharts (existing), Tailwind (existing `tac-*` tokens).

**Branch:** Work on `feat/shipping-simulator-rebuild` — **do NOT commit to `main`** (main auto-deploys to the client-facing Vercel site). First step below creates the branch.

---

## File Structure

```
lib/shipping-sim/
  types.ts            CanonicalTier, OrderRow, TaggedOrder, TierConfig, Scheme, ScenarioResult, Benchmark
  tiers.ts            CANONICAL_TIERS, tierCost(), cheapestTier()      [pure, tested]
  model.ts            revealedPremium(), landedTier(), currentScenario(), proposedScenario(), simulate()  [pure, tested]
  parse.ts            parseShippingOrders() — Shopify CSV → OrderRow[] + distinct services  [pure, tested]
  __tests__/
    tiers.test.ts
    model.test.ts
    parse.test.ts
components/simulator/
  TierConfigRow.tsx              one tier's fee / freeThreshold / flat toggle / avgCost (reused steps 2,3,4)
  steps/StepUpload.tsx
  steps/StepMapServices.tsx
  steps/StepCurrentScheme.tsx
  steps/StepProposal.tsx
  BenchmarkPanel.tsx             current-vs-proposed metrics + charts
  ShippingSimulatorWizard.tsx    step state machine + validation gates + holds all wizard state
app/simulator/page.tsx           thin — renders <ShippingSimulatorWizard/>
```

UI tasks (6–11) are verified by `npm run build` + manual dev-server QA, not unit tests — the project has no component-test infra and the spec assigns manual QA to the wizard, unit tests to the model. Pure-logic tasks (1–5) are strict TDD.

---

## Task 0: Branch + Vitest setup

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (scripts + devDependencies)

- [ ] **Step 1: Create the working branch**

```bash
cd ~/projects/tac/client-intelligence
git checkout -b feat/shipping-simulator-rebuild
```

- [ ] **Step 2: Install Vitest**

```bash
npm install -D vitest@^2
```

- [ ] **Step 3: Add the test script**

In `package.json` `"scripts"`, add after `"lint": "next lint"`:

```json
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./") },
  },
});
```

- [ ] **Step 5: Verify the runner works (no tests yet)**

Run: `npm test`
Expected: exits 0 with "No test files found" (or runs 0 tests). Confirms Vitest is wired.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore(simulator): add vitest test runner"
```

---

## Task 1: Types + tier cost helpers

**Files:**
- Create: `lib/shipping-sim/types.ts`
- Create: `lib/shipping-sim/tiers.ts`
- Test: `lib/shipping-sim/__tests__/tiers.test.ts`

- [ ] **Step 1: Create `lib/shipping-sim/types.ts`**

```ts
export type CanonicalTier = "standard" | "express" | "nextday" | "sameday";

export const CANONICAL_TIERS: CanonicalTier[] = [
  "standard",
  "express",
  "nextday",
  "sameday",
];

export const TIER_LABELS: Record<CanonicalTier, string> = {
  standard: "Standard",
  express: "Express",
  nextday: "Next Day",
  sameday: "Same Day",
};

/** A raw order parsed from the Shopify CSV. */
export interface OrderRow {
  gross: number; // gross sale / cart value
  shippingPaid: number; // shipping actually paid at checkout (ground truth)
  rawService: string; // service string as it appears in the CSV
}

/** An order after its rawService has been mapped to a canonical tier. */
export interface TaggedOrder extends OrderRow {
  tier: CanonicalTier;
}

/** Per-tier pricing + cost configuration. */
export interface TierConfig {
  tier: CanonicalTier;
  fee: number; // charged when below threshold
  freeThreshold: number | null; // free at/above this cart value; null = flat (fee always applies)
  avgCost: number; // carrier cost per order for this tier
}

/** A pricing scheme — only the tiers a merchant actually uses are present. */
export type Scheme = Partial<Record<CanonicalTier, TierConfig>>;

export interface ScenarioResult {
  shippingRevenue: number;
  carrierSpend: number;
  ordersByTier: Record<CanonicalTier, number>;
  netShippingProfit: number; // shippingRevenue - carrierSpend
}

export interface Reconciliation {
  actualShippingPaid: number; // Σ shippingPaid from the CSV
  modelledCurrentRevenue: number; // current scheme modelled revenue
  variancePct: number; // |modelled - actual| / actual  (0..1)
}

export interface CogsContext {
  cogsPercent: number;
  grossProductMargin: number; // Σ gross * (1 - cogsPercent); identical both scenarios
}

export interface Benchmark {
  current: ScenarioResult;
  proposed: ScenarioResult;
  shippingRevenueDelta: number;
  carrierSpendDelta: number;
  netProfitDelta: number; // shippingRevenueDelta - carrierSpendDelta
  reconciliation: Reconciliation;
  cogsContext?: CogsContext;
}
```

- [ ] **Step 2: Write the failing test for `tiers.ts`**

Create `lib/shipping-sim/__tests__/tiers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { tierCost, cheapestTier } from "@/lib/shipping-sim/tiers";
import { Scheme, TierConfig } from "@/lib/shipping-sim/types";

const std: TierConfig = { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 };
const exp: TierConfig = { tier: "express", fee: 15, freeThreshold: 200, avgCost: 12 };
const flatExp: TierConfig = { tier: "express", fee: 15, freeThreshold: null, avgCost: 12 };

describe("tierCost", () => {
  it("charges the fee below threshold", () => {
    expect(tierCost(std, 80)).toBe(10);
  });
  it("is free at or above threshold", () => {
    expect(tierCost(std, 100)).toBe(0);
    expect(tierCost(std, 150)).toBe(0);
  });
  it("always charges when threshold is null (flat)", () => {
    expect(tierCost(flatExp, 500)).toBe(15);
  });
});

describe("cheapestTier", () => {
  const scheme: Scheme = { standard: std, express: exp };
  it("returns the lowest-cost tier for the cart value", () => {
    // gross 150: standard free (0), express $15 -> standard cheapest
    expect(cheapestTier(scheme, 150)).toEqual({ tier: "standard", cost: 0 });
  });
  it("breaks ties toward the earliest canonical tier (standard)", () => {
    // gross 250: both free (0) -> standard wins the tie
    expect(cheapestTier(scheme, 250)).toEqual({ tier: "standard", cost: 0 });
  });
  it("throws when the scheme has no tiers", () => {
    expect(() => cheapestTier({}, 100)).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot import `tierCost`/`cheapestTier` (module not found).

- [ ] **Step 4: Create `lib/shipping-sim/tiers.ts`**

```ts
import {
  CANONICAL_TIERS,
  CanonicalTier,
  Scheme,
  TierConfig,
} from "./types";

/** Cost of a single tier for a given cart value. */
export function tierCost(config: TierConfig, gross: number): number {
  if (config.freeThreshold !== null && gross >= config.freeThreshold) {
    return 0;
  }
  return config.fee;
}

/**
 * Cheapest tier in the scheme for a given cart value.
 * Iterates in CANONICAL_TIERS order with strict `<`, so ties break toward
 * the earliest (slowest/cheapest) tier — standard first.
 */
export function cheapestTier(
  scheme: Scheme,
  gross: number
): { tier: CanonicalTier; cost: number } {
  let best: { tier: CanonicalTier; cost: number } | null = null;
  for (const tier of CANONICAL_TIERS) {
    const config = scheme[tier];
    if (!config) continue;
    const cost = tierCost(config, gross);
    if (best === null || cost < best.cost) {
      best = { tier, cost };
    }
  }
  if (best === null) {
    throw new Error("Scheme has no configured tiers");
  }
  return best;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all `tiers.test.ts` cases green.

- [ ] **Step 6: Commit**

```bash
git add lib/shipping-sim/types.ts lib/shipping-sim/tiers.ts lib/shipping-sim/__tests__/tiers.test.ts
git commit -m "feat(simulator): shipping-sim types + tier cost helpers"
```

---

## Task 2: Revealed premium + tier landing

**Files:**
- Create: `lib/shipping-sim/model.ts`
- Test: `lib/shipping-sim/__tests__/model.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/shipping-sim/__tests__/model.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { revealedPremium, landedTier } from "@/lib/shipping-sim/model";
import { Scheme, TaggedOrder, TierConfig } from "@/lib/shipping-sim/types";

const std: TierConfig = { tier: "standard", fee: 10, freeThreshold: 100, avgCost: 7 };
const exp: TierConfig = { tier: "express", fee: 15, freeThreshold: 200, avgCost: 12 };
const current: Scheme = { standard: std, express: exp };

function order(gross: number, tier: TaggedOrder["tier"]): TaggedOrder {
  return { gross, shippingPaid: 0, rawService: "x", tier };
}

describe("revealedPremium", () => {
  it("is 0 when the customer chose the cheapest tier", () => {
    // gross 150: standard free(0), express $15. Chose standard -> premium 0.
    expect(revealedPremium(order(150, "standard"), current)).toBe(0);
  });
  it("is the extra paid over the cheapest option", () => {
    // gross 150: chose express ($15) over free standard -> premium 15.
    expect(revealedPremium(order(150, "express"), current)).toBe(15);
  });
});

describe("landedTier", () => {
  it("keeps the tier when the proposed premium is within revealed WTP", () => {
    // revealed 15 (express @150). Proposed express premium 10 (<=15) -> stay express.
    const proposed: Scheme = {
      standard: { ...std, fee: 15, freeThreshold: 150 }, // std costs 15 at gross 140
      express: { ...exp, fee: 25, freeThreshold: 200 }, // express costs 25 at gross 140 -> premium 10
    };
    expect(landedTier(order(140, "express"), current, proposed)).toBe("express");
  });
  it("drops to cheapest when proposed premium exceeds revealed WTP", () => {
    // revealed 15 (express @150). Proposed express premium 20 (>15) -> drop to standard.
    const proposed: Scheme = {
      standard: { ...std, fee: 10, freeThreshold: 150 }, // std costs 10 at gross 140
      express: { ...exp, fee: 30, freeThreshold: 200 }, // express costs 30 -> premium 20
    };
    expect(landedTier(order(140, "express"), current, proposed)).toBe("standard");
  });
  it("drops to cheapest when the chosen tier is removed from the proposed scheme", () => {
    const proposed: Scheme = { standard: { ...std, fee: 12, freeThreshold: 150 } };
    expect(landedTier(order(140, "express"), current, proposed)).toBe("standard");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot import `revealedPremium`/`landedTier`.

- [ ] **Step 3: Create `lib/shipping-sim/model.ts` with these two functions**

```ts
import { cheapestTier, tierCost } from "./tiers";
import { CanonicalTier, Scheme, TaggedOrder } from "./types";

/**
 * Speed premium the customer revealed under the current scheme:
 * how much extra they paid for their chosen tier over the cheapest option.
 */
export function revealedPremium(order: TaggedOrder, current: Scheme): number {
  const chosen = current[order.tier];
  if (!chosen) {
    throw new Error(`Order tier ${order.tier} is not in the current scheme`);
  }
  const chosenCost = tierCost(chosen, order.gross);
  const cheapest = cheapestTier(current, order.gross).cost;
  return chosenCost - cheapest;
}

/**
 * Tier the order lands in under the proposed scheme.
 * Keeps the chosen tier if its proposed premium is within revealed WTP,
 * otherwise drops to the cheapest proposed tier.
 */
export function landedTier(
  order: TaggedOrder,
  current: Scheme,
  proposed: Scheme
): CanonicalTier {
  const premium = revealedPremium(order, current);
  const cheapest = cheapestTier(proposed, order.gross);
  const chosen = proposed[order.tier];
  if (!chosen) return cheapest.tier; // chosen tier no longer offered
  const stayPremium = tierCost(chosen, order.gross) - cheapest.cost;
  return stayPremium <= premium ? order.tier : cheapest.tier;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — `tiers.test.ts` + `model.test.ts` all green.

- [ ] **Step 5: Commit**

```bash
git add lib/shipping-sim/model.ts lib/shipping-sim/__tests__/model.test.ts
git commit -m "feat(simulator): revealed-WTP premium + tier landing model"
```

---

## Task 3: Scenario aggregation + simulate()

**Files:**
- Modify: `lib/shipping-sim/model.ts` (append)
- Test: `lib/shipping-sim/__tests__/model.test.ts` (append)

- [ ] **Step 1: Append failing tests to `model.test.ts`**

```ts
import {
  currentScenario,
  proposedScenario,
  simulate,
} from "@/lib/shipping-sim/model";

describe("currentScenario", () => {
  it("sums revenue and carrier cost from the actual chosen tiers", () => {
    const orders: TaggedOrder[] = [
      order(80, "standard"), // std fee 10, cost 7
      order(150, "standard"), // std free 0, cost 7
      order(150, "express"), // exp fee 15, cost 12
    ];
    const r = currentScenario(orders, current);
    expect(r.shippingRevenue).toBe(25); // 10 + 0 + 15
    expect(r.carrierSpend).toBe(26); // 7 + 7 + 12
    expect(r.netShippingProfit).toBe(-1);
    expect(r.ordersByTier).toEqual({ standard: 2, express: 1, nextday: 0, sameday: 0 });
  });
});

describe("simulate", () => {
  it("computes deltas, reconciliation, and omits cogs context when no cogs", () => {
    const orders: TaggedOrder[] = [
      { gross: 80, shippingPaid: 10, rawService: "x", tier: "standard" },
      { gross: 150, shippingPaid: 15, rawService: "x", tier: "express" },
    ];
    // Proposal: standard free over 150 (so the $80 order still pays), express premium rises
    const proposed: Scheme = {
      standard: { tier: "standard", fee: 15, freeThreshold: 150, avgCost: 7 },
      express: { tier: "express", fee: 25, freeThreshold: 250, avgCost: 12 },
    };
    const b = simulate(orders, current, proposed, undefined);
    expect(b.reconciliation.actualShippingPaid).toBe(25); // 10 + 15
    expect(b.reconciliation.modelledCurrentRevenue).toBe(b.current.shippingRevenue);
    expect(b.netProfitDelta).toBe(b.shippingRevenueDelta - b.carrierSpendDelta);
    expect(b.cogsContext).toBeUndefined();
  });

  it("adds cogs context without changing the delta", () => {
    const orders: TaggedOrder[] = [order(80, "standard")];
    const proposed: Scheme = { standard: { ...std, fee: 12 } };
    const withCogs = simulate(orders, current, proposed, 0.3);
    const without = simulate(orders, current, proposed, undefined);
    expect(withCogs.netProfitDelta).toBe(without.netProfitDelta);
    expect(withCogs.cogsContext).toEqual({ cogsPercent: 0.3, grossProductMargin: 80 * 0.7 });
  });

  it("reconciliation variance is 0 when actual paid is 0 (guard)", () => {
    const orders: TaggedOrder[] = [{ gross: 80, shippingPaid: 0, rawService: "x", tier: "standard" }];
    const b = simulate(orders, current, { standard: std }, undefined);
    expect(b.reconciliation.variancePct).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `currentScenario`/`proposedScenario`/`simulate` not exported.

- [ ] **Step 3: Append implementation to `model.ts`**

```ts
import {
  Benchmark,
  CANONICAL_TIERS,
  ScenarioResult,
} from "./types";

function emptyByTier(): Record<CanonicalTier, number> {
  return { standard: 0, express: 0, nextday: 0, sameday: 0 };
}

/** Current state: each order stays in its actual chosen tier. */
export function currentScenario(
  orders: TaggedOrder[],
  scheme: Scheme
): ScenarioResult {
  let shippingRevenue = 0;
  let carrierSpend = 0;
  const ordersByTier = emptyByTier();
  for (const o of orders) {
    const config = scheme[o.tier];
    if (!config) continue;
    shippingRevenue += tierCost(config, o.gross);
    carrierSpend += config.avgCost;
    ordersByTier[o.tier] += 1;
  }
  return {
    shippingRevenue,
    carrierSpend,
    ordersByTier,
    netShippingProfit: shippingRevenue - carrierSpend,
  };
}

/** Proposed state: each order lands per the revealed-WTP model. */
export function proposedScenario(
  orders: TaggedOrder[],
  current: Scheme,
  proposed: Scheme
): ScenarioResult {
  let shippingRevenue = 0;
  let carrierSpend = 0;
  const ordersByTier = emptyByTier();
  for (const o of orders) {
    const landed = landedTier(o, current, proposed);
    const config = proposed[landed];
    if (!config) continue;
    shippingRevenue += tierCost(config, o.gross);
    carrierSpend += config.avgCost;
    ordersByTier[landed] += 1;
  }
  return {
    shippingRevenue,
    carrierSpend,
    ordersByTier,
    netShippingProfit: shippingRevenue - carrierSpend,
  };
}

/** Full current-vs-proposed benchmark. */
export function simulate(
  orders: TaggedOrder[],
  current: Scheme,
  proposed: Scheme,
  cogsPercent?: number
): Benchmark {
  const currentResult = currentScenario(orders, current);
  const proposedResult = proposedScenario(orders, current, proposed);

  const actualShippingPaid = orders.reduce((s, o) => s + o.shippingPaid, 0);
  const variancePct =
    actualShippingPaid > 0
      ? Math.abs(currentResult.shippingRevenue - actualShippingPaid) /
        actualShippingPaid
      : 0;

  const shippingRevenueDelta =
    proposedResult.shippingRevenue - currentResult.shippingRevenue;
  const carrierSpendDelta =
    proposedResult.carrierSpend - currentResult.carrierSpend;

  const benchmark: Benchmark = {
    current: currentResult,
    proposed: proposedResult,
    shippingRevenueDelta,
    carrierSpendDelta,
    netProfitDelta: shippingRevenueDelta - carrierSpendDelta,
    reconciliation: {
      actualShippingPaid,
      modelledCurrentRevenue: currentResult.shippingRevenue,
      variancePct,
    },
  };

  if (cogsPercent !== undefined) {
    const grossSum = orders.reduce((s, o) => s + o.gross, 0);
    benchmark.cogsContext = {
      cogsPercent,
      grossProductMargin: grossSum * (1 - cogsPercent),
    };
  }

  return benchmark;
}
```

Note: the existing `import` block at the top of `model.ts` already imports `CanonicalTier, Scheme, TaggedOrder`. Merge the new type imports (`Benchmark, CANONICAL_TIERS, ScenarioResult`) into that single import statement rather than adding a duplicate `from "./types"` line.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all model + tier tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/shipping-sim/model.ts lib/shipping-sim/__tests__/model.test.ts
git commit -m "feat(simulator): scenario aggregation + simulate() benchmark"
```

---

## Task 4: CSV parser

**Files:**
- Create: `lib/shipping-sim/parse.ts`
- Test: `lib/shipping-sim/__tests__/parse.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/shipping-sim/__tests__/parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseShippingOrders } from "@/lib/shipping-sim/parse";

describe("parseShippingOrders", () => {
  it("parses gross, shipping paid, and service, and lists distinct services", () => {
    const csv = [
      "Total,Shipping,Shipping Method",
      "$120.00,$0.00,Standard",
      "80,15,Express",
      "200,0,Standard",
    ].join("\n");
    const r = parseShippingOrders(csv);
    expect(r.errors).toEqual([]);
    expect(r.orders).toHaveLength(3);
    expect(r.orders[0]).toEqual({ gross: 120, shippingPaid: 0, rawService: "Standard" });
    expect(r.orders[1]).toEqual({ gross: 80, shippingPaid: 15, rawService: "Express" });
    expect(r.services).toEqual(["Express", "Standard"]); // sorted, distinct
  });

  it("errors when a required column is missing", () => {
    const csv = ["Total,Shipping", "120,0"].join("\n");
    const r = parseShippingOrders(csv);
    expect(r.orders).toHaveLength(0);
    expect(r.errors.some((e) => e.includes("service"))).toBe(true);
  });

  it("skips rows with unreadable gross and warns", () => {
    const csv = ["Total,Shipping,Shipping Method", "abc,5,Standard", "100,5,Standard"].join("\n");
    const r = parseShippingOrders(csv);
    expect(r.orders).toHaveLength(1);
    expect(r.warnings.some((w) => w.includes("skipped"))).toBe(true);
  });

  it("defaults a blank service to 'Unknown'", () => {
    const csv = ["Total,Shipping,Shipping Method", "100,5,"].join("\n");
    const r = parseShippingOrders(csv);
    expect(r.orders[0].rawService).toBe("Unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot import `parseShippingOrders`.

- [ ] **Step 3: Create `lib/shipping-sim/parse.ts`**

```ts
import Papa from "papaparse";
import { OrderRow } from "./types";

const GROSS_COLS = ["total", "total price", "total_price", "gross sales", "gross", "subtotal"];
const SHIPPING_COLS = ["shipping", "shipping paid", "shipping price", "shipping amount", "shipping_amount"];
const SERVICE_COLS = ["shipping method", "shipping_method", "service", "carrier", "shipping line", "delivery method"];

export interface ParseResult {
  orders: OrderRow[];
  services: string[]; // distinct, sorted
  errors: string[];
  warnings: string[];
}

function findCol(row: Record<string, string>, candidates: string[]): string | null {
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const hit = keys.find((k) => k === candidate);
    if (hit) return hit;
  }
  return null;
}

function toNumber(value: string | undefined): number {
  const cleaned = (value ?? "").toString().replace(/[^0-9.\-]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

export function parseShippingOrders(csvText: string): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim().toLowerCase(),
  });

  const rows = (parsed.data as Record<string, string>[]) ?? [];
  if (rows.length === 0) {
    errors.push("No data rows found in CSV");
    return { orders: [], services: [], errors, warnings };
  }

  const grossCol = findCol(rows[0], GROSS_COLS);
  const shipCol = findCol(rows[0], SHIPPING_COLS);
  const svcCol = findCol(rows[0], SERVICE_COLS);

  if (!grossCol) errors.push('Missing required column: gross sale (e.g. "Total")');
  if (!shipCol) errors.push('Missing required column: shipping paid (e.g. "Shipping")');
  if (!svcCol) errors.push('Missing required column: service at checkout (e.g. "Shipping Method")');
  if (errors.length > 0) return { orders: [], services: [], errors, warnings };

  const orders: OrderRow[] = [];
  const serviceSet = new Set<string>();
  let skipped = 0;

  for (const row of rows) {
    const gross = toNumber(row[grossCol!]);
    const shippingPaid = toNumber(row[shipCol!]);
    const rawService = (row[svcCol!] ?? "").trim() || "Unknown";
    if (Number.isNaN(gross)) {
      skipped += 1;
      continue;
    }
    orders.push({
      gross,
      shippingPaid: Number.isNaN(shippingPaid) ? 0 : shippingPaid,
      rawService,
    });
    serviceSet.add(rawService);
  }

  if (skipped > 0) {
    warnings.push(`${skipped} row(s) skipped — unreadable gross sale value`);
  }

  return {
    orders,
    services: Array.from(serviceSet).sort(),
    errors,
    warnings,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all parse tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/shipping-sim/parse.ts lib/shipping-sim/__tests__/parse.test.ts
git commit -m "feat(simulator): Shopify CSV parser for gross/shipping/service"
```

---

## Task 5: TierConfigRow component

**Files:**
- Create: `components/simulator/TierConfigRow.tsx`

A controlled row for one tier: label, fee input, free-threshold input with a "flat (no free shipping)" toggle, and an optional avg-cost input. Reused in steps 2 (avg cost), 3, and 4. No unit test — verified via build + the steps that use it.

- [ ] **Step 1: Create `components/simulator/TierConfigRow.tsx`**

```tsx
"use client";

import InputField from "@/components/shared/InputField";
import { CanonicalTier, TIER_LABELS } from "@/lib/shipping-sim/types";

interface TierConfigRowProps {
  tier: CanonicalTier;
  fee: number;
  freeThreshold: number | null; // null = flat
  avgCost: number;
  showFeeThreshold?: boolean; // steps 3 & 4
  showAvgCost?: boolean; // step 2
  orderCount?: number; // optional context badge
  onChange: (patch: { fee?: number; freeThreshold?: number | null; avgCost?: number }) => void;
}

export default function TierConfigRow({
  tier,
  fee,
  freeThreshold,
  avgCost,
  showFeeThreshold = false,
  showAvgCost = false,
  orderCount,
  onChange,
}: TierConfigRowProps) {
  const isFlat = freeThreshold === null;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-tac-accent">{TIER_LABELS[tier]}</h4>
        {orderCount !== undefined && (
          <span className="text-xs text-tac-muted">{orderCount} orders</span>
        )}
      </div>

      {showAvgCost && (
        <InputField
          label="Avg carrier cost / order"
          value={avgCost}
          onChange={(v) => onChange({ avgCost: v })}
          prefix="$"
          step={0.5}
          min={0}
          tooltip="What it costs the merchant to ship one order on this service"
        />
      )}

      {showFeeThreshold && (
        <div className="space-y-3 mt-3">
          <InputField
            label="Shipping fee"
            value={fee}
            onChange={(v) => onChange({ fee: v })}
            prefix="$"
            step={0.5}
            min={0}
          />
          <label className="flex items-center gap-2 cursor-pointer text-sm text-tac-text">
            <input
              type="checkbox"
              checked={isFlat}
              onChange={(e) => onChange({ freeThreshold: e.target.checked ? null : 100 })}
              className="accent-tac-accent w-4 h-4"
            />
            Flat rate (no free-shipping threshold)
          </label>
          {!isFlat && (
            <InputField
              label="Free over"
              value={freeThreshold ?? 0}
              onChange={(v) => onChange({ freeThreshold: v })}
              prefix="$"
              step={5}
              min={0}
              tooltip="Orders at or above this cart value ship free on this service"
            />
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds (component is unused so far but must type-check).

- [ ] **Step 3: Commit**

```bash
git add components/simulator/TierConfigRow.tsx
git commit -m "feat(simulator): TierConfigRow input component"
```

---

## Task 6: Wizard container + state

**Files:**
- Create: `components/simulator/ShippingSimulatorWizard.tsx`

Holds ALL wizard state and the step machine. Renders the active step and Next/Back. Validation gates control whether Next is enabled. Step components (Task 7) and BenchmarkPanel (Task 8) are imported here; build this first with placeholder step bodies, then fill steps in Task 7.

- [ ] **Step 1: Create `components/simulator/ShippingSimulatorWizard.tsx`**

State shape and machine — fill step rendering with the components created in Task 7:

```tsx
"use client";

import { useMemo, useState } from "react";
import Nav from "@/components/shared/Nav";
import { parseShippingOrders } from "@/lib/shipping-sim/parse";
import { simulate } from "@/lib/shipping-sim/model";
import {
  CanonicalTier,
  OrderRow,
  Scheme,
  TaggedOrder,
  TierConfig,
} from "@/lib/shipping-sim/types";
import StepUpload from "./steps/StepUpload";
import StepMapServices from "./steps/StepMapServices";
import StepCurrentScheme from "./steps/StepCurrentScheme";
import StepProposal from "./steps/StepProposal";

export type ServiceMap = Record<string, CanonicalTier | "exclude">;

const STEPS = ["Upload", "Map services", "Current state", "Proposal"] as const;

export default function ShippingSimulatorWizard() {
  const [step, setStep] = useState(0);

  // Step 1
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);

  // Step 2
  const [serviceMap, setServiceMap] = useState<ServiceMap>({});
  const [avgCosts, setAvgCosts] = useState<Partial<Record<CanonicalTier, number>>>({});

  // Steps 3 & 4 — fee/threshold per tier
  const [currentTiers, setCurrentTiers] = useState<Partial<Record<CanonicalTier, { fee: number; freeThreshold: number | null }>>>({});
  const [proposedTiers, setProposedTiers] = useState<Partial<Record<CanonicalTier, { fee: number; freeThreshold: number | null }>>>({});
  const [cogsPercent, setCogsPercent] = useState<number | undefined>(undefined);

  function handleUpload(csvText: string) {
    const r = parseShippingOrders(csvText);
    setOrders(r.orders);
    setServices(r.services);
    setParseErrors(r.errors);
    setParseWarnings(r.warnings);
  }

  // Tiers actually used (mapped to a canonical tier, not excluded)
  const usedTiers = useMemo<CanonicalTier[]>(() => {
    const set = new Set<CanonicalTier>();
    for (const svc of services) {
      const m = serviceMap[svc];
      if (m && m !== "exclude") set.add(m);
    }
    return Array.from(set);
  }, [services, serviceMap]);

  // Orders tagged with canonical tier (excluded services dropped)
  const taggedOrders = useMemo<TaggedOrder[]>(() => {
    return orders
      .map((o) => {
        const m = serviceMap[o.rawService];
        if (!m || m === "exclude") return null;
        return { ...o, tier: m };
      })
      .filter((o): o is TaggedOrder => o !== null);
  }, [orders, serviceMap]);

  function buildScheme(
    tierVals: Partial<Record<CanonicalTier, { fee: number; freeThreshold: number | null }>>
  ): Scheme {
    const scheme: Scheme = {};
    for (const tier of usedTiers) {
      const vals = tierVals[tier];
      const config: TierConfig = {
        tier,
        fee: vals?.fee ?? 0,
        freeThreshold: vals?.freeThreshold ?? null,
        avgCost: avgCosts[tier] ?? 0,
      };
      scheme[tier] = config;
    }
    return scheme;
  }

  const benchmark = useMemo(() => {
    if (step < 3 || taggedOrders.length === 0 || usedTiers.length === 0) return null;
    return simulate(taggedOrders, buildScheme(currentTiers), buildScheme(proposedTiers), cogsPercent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, taggedOrders, usedTiers, currentTiers, proposedTiers, avgCosts, cogsPercent]);

  // Validation gates
  const canAdvance = useMemo(() => {
    if (step === 0) return orders.length > 0 && parseErrors.length === 0;
    if (step === 1)
      return (
        services.every((s) => serviceMap[s] !== undefined) &&
        usedTiers.every((t) => (avgCosts[t] ?? 0) >= 0 && avgCosts[t] !== undefined)
      );
    if (step === 2) return usedTiers.every((t) => currentTiers[t] !== undefined);
    return true;
  }, [step, orders, parseErrors, services, serviceMap, usedTiers, avgCosts, currentTiers]);

  return (
    <>
      <Nav />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-2">Shipping Strategy Simulator</h1>

        {/* Step indicator */}
        <div className="flex gap-2 mb-8">
          {STEPS.map((label, i) => (
            <div
              key={label}
              className={`flex-1 text-center text-sm py-2 rounded-lg border ${
                i === step
                  ? "border-tac-accent text-tac-accent"
                  : i < step
                  ? "border-tac-success/40 text-tac-success"
                  : "border-tac-border text-tac-muted"
              }`}
            >
              {i + 1}. {label}
            </div>
          ))}
        </div>

        {step === 0 && (
          <StepUpload
            orders={orders}
            errors={parseErrors}
            warnings={parseWarnings}
            onUpload={handleUpload}
          />
        )}
        {step === 1 && (
          <StepMapServices
            services={services}
            serviceMap={serviceMap}
            avgCosts={avgCosts}
            usedTiers={usedTiers}
            onMapChange={(svc, tier) => setServiceMap((p) => ({ ...p, [svc]: tier }))}
            onAvgCostChange={(tier, v) => setAvgCosts((p) => ({ ...p, [tier]: v }))}
          />
        )}
        {step === 2 && (
          <StepCurrentScheme
            orders={taggedOrders}
            usedTiers={usedTiers}
            avgCosts={avgCosts}
            tierVals={currentTiers}
            onChange={(tier, patch) =>
              setCurrentTiers((p) => ({ ...p, [tier]: { fee: 0, freeThreshold: null, ...p[tier], ...patch } }))
            }
          />
        )}
        {step === 3 && (
          <StepProposal
            usedTiers={usedTiers}
            tierVals={proposedTiers}
            currentTierVals={currentTiers}
            cogsPercent={cogsPercent}
            benchmark={benchmark}
            onChange={(tier, patch) =>
              setProposedTiers((p) => ({ ...p, [tier]: { fee: 0, freeThreshold: null, ...p[tier], ...patch } }))
            }
            onCogsChange={setCogsPercent}
          />
        )}

        {/* Nav buttons */}
        <div className="flex justify-between mt-8">
          <button
            className="btn-secondary"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            Back
          </button>
          {step < STEPS.length - 1 && (
            <button className="btn-primary" disabled={!canAdvance} onClick={() => setStep((s) => s + 1)}>
              Next
            </button>
          )}
        </div>
      </main>
    </>
  );
}
```

- [ ] **Step 2: Seed proposed tiers from current on entering step 3**

So the proposal starts as a copy of current (user tweaks from there). Add this effect after the state declarations:

```tsx
import { useEffect } from "react";

// ...inside the component, after currentTiers/proposedTiers declared:
useEffect(() => {
  if (step === 3 && Object.keys(proposedTiers).length === 0) {
    setProposedTiers(currentTiers);
  }
}, [step, proposedTiers, currentTiers]);
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: build FAILS only because Task 7 step components don't exist yet. If you build Task 7 first this passes; otherwise proceed to Task 7 and build there. (Commit happens at the end of Task 7.)

---

## Task 7: Step components

**Files:**
- Create: `components/simulator/steps/StepUpload.tsx`
- Create: `components/simulator/steps/StepMapServices.tsx`
- Create: `components/simulator/steps/StepCurrentScheme.tsx`
- Create: `components/simulator/steps/StepProposal.tsx`

- [ ] **Step 1: Create `StepUpload.tsx`**

```tsx
"use client";

import CsvUploader from "@/components/shared/CsvUploader";
import { OrderRow } from "@/lib/shipping-sim/types";
import { formatNumber } from "@/lib/calculations";

interface StepUploadProps {
  orders: OrderRow[];
  errors: string[];
  warnings: string[];
  onUpload: (csvText: string) => void;
}

export default function StepUpload({ orders, errors, warnings, onUpload }: StepUploadProps) {
  return (
    <div>
      <p className="text-tac-muted mb-4">
        Upload a Shopify orders export. We need three columns: gross sale (Total), shipping paid
        (Shipping), and the service selected at checkout (Shipping Method).
      </p>
      <CsvUploader
        label="Upload Shopify Orders CSV"
        description="Required: Total, Shipping, Shipping Method"
        onUpload={(text) => onUpload(text)}
      />
      {errors.map((e, i) => (
        <p key={i} className="text-sm text-tac-danger mt-2">{e}</p>
      ))}
      {warnings.map((w, i) => (
        <p key={i} className="text-sm text-tac-warning mt-2">{w}</p>
      ))}
      {orders.length > 0 && (
        <p className="text-sm text-tac-success mt-3">✓ {formatNumber(orders.length)} orders loaded</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `StepMapServices.tsx`**

```tsx
"use client";

import InputField from "@/components/shared/InputField";
import {
  CanonicalTier,
  CANONICAL_TIERS,
  TIER_LABELS,
} from "@/lib/shipping-sim/types";
import { ServiceMap } from "../ShippingSimulatorWizard";

interface StepMapServicesProps {
  services: string[];
  serviceMap: ServiceMap;
  avgCosts: Partial<Record<CanonicalTier, number>>;
  usedTiers: CanonicalTier[];
  onMapChange: (service: string, tier: CanonicalTier | "exclude") => void;
  onAvgCostChange: (tier: CanonicalTier, value: number) => void;
}

export default function StepMapServices({
  services,
  serviceMap,
  avgCosts,
  usedTiers,
  onMapChange,
  onAvgCostChange,
}: StepMapServicesProps) {
  return (
    <div className="space-y-8">
      <div className="card">
        <h3 className="text-lg font-semibold mb-4 text-tac-accent">Map checkout services</h3>
        <div className="space-y-2">
          {services.map((svc) => (
            <div key={svc} className="flex items-center justify-between gap-4">
              <span className="text-sm text-tac-text">{svc}</span>
              <select
                className="input-field max-w-xs"
                value={serviceMap[svc] ?? ""}
                onChange={(e) => onMapChange(svc, e.target.value as CanonicalTier | "exclude")}
              >
                <option value="" disabled>Assign…</option>
                {CANONICAL_TIERS.map((t) => (
                  <option key={t} value={t}>{TIER_LABELS[t]}</option>
                ))}
                <option value="exclude">Exclude</option>
              </select>
            </div>
          ))}
        </div>
      </div>

      {usedTiers.length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold mb-4 text-tac-accent">Avg carrier cost per order</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {usedTiers.map((t) => (
              <InputField
                key={t}
                label={TIER_LABELS[t]}
                value={avgCosts[t] ?? 0}
                onChange={(v) => onAvgCostChange(t, v)}
                prefix="$"
                step={0.5}
                min={0}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `StepCurrentScheme.tsx`**

Uses `TierConfigRow` for fee/threshold, and shows per-tier order counts + % of total. `bucketStats` is computed inline from the tagged orders.

```tsx
"use client";

import { useMemo } from "react";
import TierConfigRow from "../TierConfigRow";
import { CanonicalTier, TaggedOrder } from "@/lib/shipping-sim/types";
import { formatPercent } from "@/lib/calculations";

interface StepCurrentSchemeProps {
  orders: TaggedOrder[];
  usedTiers: CanonicalTier[];
  avgCosts: Partial<Record<CanonicalTier, number>>;
  tierVals: Partial<Record<CanonicalTier, { fee: number; freeThreshold: number | null }>>;
  onChange: (tier: CanonicalTier, patch: { fee?: number; freeThreshold?: number | null }) => void;
}

export default function StepCurrentScheme({
  orders,
  usedTiers,
  avgCosts,
  tierVals,
  onChange,
}: StepCurrentSchemeProps) {
  const counts = useMemo(() => {
    const c: Partial<Record<CanonicalTier, number>> = {};
    for (const o of orders) c[o.tier] = (c[o.tier] ?? 0) + 1;
    return c;
  }, [orders]);

  return (
    <div>
      <p className="text-tac-muted mb-4">
        Enter the merchant&apos;s current shipping fee and free-over threshold for each service.
        Tick &quot;flat rate&quot; for services with no free-shipping threshold.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {usedTiers.map((t) => (
          <TierConfigRow
            key={t}
            tier={t}
            fee={tierVals[t]?.fee ?? 0}
            freeThreshold={tierVals[t]?.freeThreshold ?? null}
            avgCost={avgCosts[t] ?? 0}
            showFeeThreshold
            orderCount={counts[t] ?? 0}
            onChange={(patch) => onChange(t, patch)}
          />
        ))}
      </div>
      <p className="text-xs text-tac-muted mt-4">
        Share of orders:{" "}
        {usedTiers
          .map((t) => `${t} ${formatPercent((counts[t] ?? 0) / Math.max(orders.length, 1))}`)
          .join(" · ")}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Create `StepProposal.tsx`**

Renders editable tier rows + optional COGS input + the `BenchmarkPanel` (Task 8).

```tsx
"use client";

import TierConfigRow from "../TierConfigRow";
import BenchmarkPanel from "../BenchmarkPanel";
import InputField from "@/components/shared/InputField";
import { Benchmark, CanonicalTier } from "@/lib/shipping-sim/types";

interface StepProposalProps {
  usedTiers: CanonicalTier[];
  tierVals: Partial<Record<CanonicalTier, { fee: number; freeThreshold: number | null }>>;
  currentTierVals: Partial<Record<CanonicalTier, { fee: number; freeThreshold: number | null }>>;
  cogsPercent: number | undefined;
  benchmark: Benchmark | null;
  onChange: (tier: CanonicalTier, patch: { fee?: number; freeThreshold?: number | null }) => void;
  onCogsChange: (value: number | undefined) => void;
}

export default function StepProposal({
  usedTiers,
  tierVals,
  cogsPercent,
  benchmark,
  onChange,
  onCogsChange,
}: StepProposalProps) {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-tac-muted mb-4">
          Adjust the proposed fee and free-over threshold per service. The benchmark below updates live.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {usedTiers.map((t) => (
            <TierConfigRow
              key={t}
              tier={t}
              fee={tierVals[t]?.fee ?? 0}
              freeThreshold={tierVals[t]?.freeThreshold ?? null}
              avgCost={0}
              showFeeThreshold
              onChange={(patch) => onChange(t, patch)}
            />
          ))}
        </div>
      </div>

      <div className="card max-w-sm">
        <label className="flex items-center gap-2 cursor-pointer text-sm text-tac-text mb-3">
          <input
            type="checkbox"
            checked={cogsPercent !== undefined}
            onChange={(e) => onCogsChange(e.target.checked ? 0.3 : undefined)}
            className="accent-tac-accent w-4 h-4"
          />
          Add COGS % for full-margin context (optional)
        </label>
        {cogsPercent !== undefined && (
          <InputField
            label="COGS %"
            value={cogsPercent * 100}
            onChange={(v) => onCogsChange(v / 100)}
            suffix="%"
            step={1}
            min={0}
            max={100}
          />
        )}
      </div>

      {benchmark && <BenchmarkPanel benchmark={benchmark} />}
    </div>
  );
}
```

- [ ] **Step 5: Build (will fail until BenchmarkPanel exists — proceed to Task 8)**

Run: `npm run build`
Expected: FAILS only on the missing `BenchmarkPanel` import. Fixed in Task 8.

---

## Task 8: BenchmarkPanel

**Files:**
- Create: `components/simulator/BenchmarkPanel.tsx`

- [ ] **Step 1: Create `components/simulator/BenchmarkPanel.tsx`**

```tsx
"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import MetricCard from "@/components/shared/MetricCard";
import { Benchmark, CANONICAL_TIERS, TIER_LABELS } from "@/lib/shipping-sim/types";
import { formatCurrency, formatPercent } from "@/lib/calculations";

interface BenchmarkPanelProps {
  benchmark: Benchmark;
}

export default function BenchmarkPanel({ benchmark }: BenchmarkPanelProps) {
  const { current, proposed, reconciliation } = benchmark;

  const mixData = CANONICAL_TIERS.filter(
    (t) => current.ordersByTier[t] > 0 || proposed.ordersByTier[t] > 0
  ).map((t) => ({
    tier: TIER_LABELS[t],
    Current: current.ordersByTier[t],
    Proposed: proposed.ordersByTier[t],
  }));

  const reconHigh = reconciliation.variancePct > 0.1;

  return (
    <div className="space-y-6">
      {/* Reconciliation badge */}
      <div
        className={`p-3 rounded-lg border text-sm ${
          reconHigh
            ? "bg-tac-danger/10 border-tac-danger/30 text-tac-danger"
            : "bg-tac-success/10 border-tac-success/30 text-tac-success"
        }`}
      >
        Current-scheme model reproduces {formatPercent(1 - reconciliation.variancePct)} of actual
        shipping revenue ({formatCurrency(reconciliation.modelledCurrentRevenue)} modelled vs{" "}
        {formatCurrency(reconciliation.actualShippingPaid)} actual).
        {reconHigh && " High variance — re-check the current scheme before trusting the proposal."}
      </div>

      {/* Headline deltas */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <MetricCard
          label="Δ Shipping Revenue"
          value={formatCurrency(benchmark.shippingRevenueDelta)}
        />
        <MetricCard label="Δ Carrier Spend" value={formatCurrency(benchmark.carrierSpendDelta)} />
        <MetricCard label="Net Profit Δ" value={formatCurrency(benchmark.netProfitDelta)} accent />
      </div>

      {/* Current vs proposed table */}
      <div className="card overflow-x-auto">
        <h3 className="text-lg font-semibold mb-4 text-tac-accent">Current vs Proposed</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-tac-border text-tac-muted">
              <th className="text-left py-2">Metric</th>
              <th className="text-right py-2 px-3">Current</th>
              <th className="text-right py-2 px-3">Proposed</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-tac-border/50">
              <td className="py-2">Shipping revenue</td>
              <td className="text-right px-3">{formatCurrency(current.shippingRevenue)}</td>
              <td className="text-right px-3">{formatCurrency(proposed.shippingRevenue)}</td>
            </tr>
            <tr className="border-b border-tac-border/50">
              <td className="py-2">Carrier spend</td>
              <td className="text-right px-3">{formatCurrency(current.carrierSpend)}</td>
              <td className="text-right px-3">{formatCurrency(proposed.carrierSpend)}</td>
            </tr>
            <tr>
              <td className="py-2 font-semibold">Net shipping profit</td>
              <td className="text-right px-3 font-semibold">{formatCurrency(current.netShippingProfit)}</td>
              <td className="text-right px-3 font-semibold">{formatCurrency(proposed.netShippingProfit)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Tier mix shift */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4 text-tac-accent">Carrier mix shift</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={mixData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2D4050" />
            <XAxis dataKey="tier" tick={{ fontSize: 12, fill: "#A0AEB8" }} />
            <YAxis tick={{ fontSize: 11, fill: "#A0AEB8" }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1F3040",
                border: "1px solid #2D4050",
                borderRadius: 8,
                color: "#fff",
              }}
            />
            <Legend />
            <Bar dataKey="Current" fill="#A0AEB8" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Proposed" fill="#F5B36B" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {benchmark.cogsContext && (
        <div className="card">
          <h3 className="text-lg font-semibold mb-2 text-tac-accent">Full-margin context</h3>
          <p className="text-sm text-tac-muted">
            Gross product margin at {formatPercent(benchmark.cogsContext.cogsPercent)} COGS:{" "}
            {formatCurrency(benchmark.cogsContext.grossProductMargin)}. This is identical in both
            scenarios — cart sizes don&apos;t change — so it does not affect the profit delta above.
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build the full UI now that all components exist**

Run: `npm run build`
Expected: PASS — all simulator components type-check and compile.

- [ ] **Step 3: Commit Tasks 6–8 together (they form one compilable unit)**

```bash
git add components/simulator/
git commit -m "feat(simulator): wizard container, step components, benchmark panel"
```

---

## Task 9: Wire the page + remove the old monolith

**Files:**
- Modify: `app/simulator/page.tsx` (replace entire contents)

- [ ] **Step 1: Replace `app/simulator/page.tsx` with the thin shell**

```tsx
import ShippingSimulatorWizard from "@/components/simulator/ShippingSimulatorWizard";

export default function SimulatorPage() {
  return <ShippingSimulatorWizard />;
}
```

- [ ] **Step 2: Confirm nothing else imports the old page internals**

Run: `grep -rn "from \"@/app/simulator" --include=*.ts --include=*.tsx . | grep -v node_modules`
Expected: no results (the page had no exported internals).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS — `/simulator` route still present, now rendering the wizard. The old `useMemo`/`orders.length` warning is gone (old code removed).

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — all `lib/shipping-sim` tests green.

- [ ] **Step 5: Commit**

```bash
git add app/simulator/page.tsx
git commit -m "feat(simulator): replace monolith page with wizard shell"
```

---

## Task 10: Manual QA on the dev server

**Files:** none (verification only)

- [ ] **Step 1: Restart the dev server**

Run: `pm2 restart client-intelligence && pm2 logs client-intelligence --lines 5 --nostream`
Expected: compiles, serving on :3001.

- [ ] **Step 2: Walk the wizard at http://localhost:3001/simulator**

Verify in order:
- Upload a Shopify CSV with Total / Shipping / Shipping Method columns → row count shows, Next enables.
- Step 2: every distinct service appears; assigning all + entering avg costs enables Next.
- Step 3: fee/threshold per used tier; flat toggle hides the threshold; order-share line renders; Next enables when all tiers configured.
- Step 4: editing proposed fees/thresholds updates the benchmark live; reconciliation badge reflects variance; toggling COGS shows the context panel without changing Net Profit Δ; carrier-mix bars shift when a proposal makes express pricier.

- [ ] **Step 3: Note any defects**

If behaviour diverges from the spec model, fix in the relevant `lib/shipping-sim` file with a new failing test first (TDD), then re-run `npm test` and `npm run build`.

---

## Task 11: Finish the branch

**Files:** none

- [ ] **Step 1: Final verification**

Run: `npm test && npm run build`
Expected: tests PASS, build PASS.

- [ ] **Step 2: Push the branch (does NOT deploy — not main)**

```bash
git push -u origin feat/shipping-simulator-rebuild
```

- [ ] **Step 3: Hand back to Damo**

Surface: branch pushed, all tests/build green, dev server walked. Ask whether to open a PR / merge to main (merge = live deploy to the client-facing site) — do not merge without explicit approval.

---

## Self-Review

**Spec coverage:**
- §2 canonical tiers → Task 1 types (`CANONICAL_TIERS`, exclude in Task 6 `ServiceMap`). ✓
- §3 data model → Task 1 types.ts. ✓
- §4.1 cost → Task 1 `tierCost`. ✓ §4.2 revealed premium → Task 2. ✓ §4.3 landing → Task 2. ✓ §4.4 two levers → Task 3 `simulate`. ✓ §4.5 COGS context → Task 3 + Task 7/8. ✓ §4.6 reconciliation → Task 3 + Task 8 badge. ✓
- §5 wizard steps → Tasks 6–8. ✓
- §6 architecture/files → matches Tasks 1–9. ✓
- §7 edge cases → covered by tests (empty/single tier, all-flat, div-by-zero in `simulate` variance guard, NaN skip in parser) + validation gates in Task 6. ✓
- §8 testing → Tasks 1–4 TDD + Task 10 manual QA. ✓
- §9 dropped scope → Task 9 removes monolith; `lib/calculations.ts` untouched (only imported for formatters). ✓ Palette: components use existing `tac-*` tokens. ✓
- §10 persistence → omitted by default (no localStorage), matching the spec default. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; commands have expected output. ✓

**Type consistency:** `Scheme` is `Partial<Record<CanonicalTier, TierConfig>>` throughout. `simulate(orders, current, proposed, cogsPercent?)` signature consistent across Tasks 3, 6. `landedTier(order, current, proposed)` consistent Tasks 2, 3. `TierConfigRow` `onChange` patch shape (`{fee?, freeThreshold?, avgCost?}`) consistent Tasks 5, 7. `ServiceMap` exported from wizard, imported by StepMapServices. ✓