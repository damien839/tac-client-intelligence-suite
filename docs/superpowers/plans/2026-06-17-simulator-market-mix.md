---
title: Simulator Market-Mix (Geo) Section
date: 2026-06-17
tags: [claude]
project: tac
status: draft
type: note
---

# Simulator — "Market Mix" (Geo) Section Implementation Brief

> **Status: DRAFT — awaiting Damo's sign-off before any code.**

**Why:** The AOV deep-dive's section 04 (region + country breakdown) is the one view not ported into the Curve Anatomy section. It answers *who spends, who qualifies for free shipping, and where the premium buyers are* — a targeting/merchandising lens, not a shipping-pricing one. It was deferred because, unlike the rest of curve anatomy, it needs a data field the parser doesn't capture: destination country.

**Good news on data:** real Shopify order exports already carry it. The UK/EU client file has `Shipping Country`, `Shipping Province`, `Shipping City`. So this is a parser-capture + presentation job, not a "go get new data" job — but it IS a parser/type change, which is why it's a separate brief from the pure-presentation curve anatomy.

**Branch:** new branch `feat/simulator-market-mix` off `main` once `feat/simulator-options-comparison` merges (or continue on it if not yet merged — Damo's call). No merge to main without sign-off (merge = live deploy).

**Tech stack:** unchanged — Next 14, TS strict, Vitest, recharts, tac-* tokens.

---

## Scope boundary (important)

This section is **descriptive only**. It does NOT make the recommendation engine market-aware — the simulator still models one scheme across the whole upload. Geo tells the operator *where the spend and free-ship qualification sit*; it does not optimise per-country thresholds.

**Tension to flag in the UI:** the wizard tells users to upload "one market at a time… mixing currencies will skew the analysis." Market Mix shows country splits *within* one upload — which is only coherent when those countries share a currency and shipping policy (as the UK/EU AUD-priced file does). The section copy must state: amounts are the single uploaded currency; this is a sub-breakdown of one pricing zone, not a multi-currency comparison.

---

## Task 1: Capture country in the parser

**Files:** `lib/shipping-sim/parse.ts`, `lib/shipping-sim/types.ts`; tests in `parse.test.ts`.

- `OrderRow` gains `country?: string` (ISO-ish code as it appears in the export, e.g. "GB", "DE"; undefined when absent).
- New `COUNTRY_COLS = ["shipping country", "country", "shipping_country", "destination country"]`. Optional — no error when missing.
- Both parser modes (summary + full-export) populate `country` when the column exists; trim, uppercase. Blank → undefined.
- `ParseResult` gains `hasCountry: boolean` so the UI knows whether to render the section.

**Tests:** country captured + uppercased in summary and full-export modes; absent column → `country` undefined, `hasCountry` false, no error.

## Task 2: Geo stats

**Files:** new `lib/shipping-sim/geo.ts`; new `country-regions.ts` data map; new `types.ts` additions; test `geo.test.ts`.

**Region map (`country-regions.ts`):** `COUNTRY_REGION: Record<string, Region>` where `Region = "UK" | "EU" | "EFTA" | "NA" | "ANZ" | "Other"`. Seed with the common AU-export destinations (GB→UK; DE/FR/IE/NL/SE/etc→EU; CH/NO→EFTA; US/CA→NA; AU/NZ→ANZ). Unknown codes → "Other". Extensible; document that it's a lookup, not exhaustive.

**Contract:**
```ts
export interface GeoRow {
  key: string;            // country code or region name
  region: Region;         // for country rows; === key for region rows
  n: number;
  aov: number;
  median: number;
  gmv: number;
  freePct: number;        // % of the group's orders that ship free under the current scheme (0..100)
}
export interface GeoStats {
  byRegion: GeoRow[];     // count-desc
  byCountry: GeoRow[];    // count-desc, all countries (UI filters to n >= MIN_COUNTRY_N)
  hasCountry: boolean;
}
export function geoStats(orders: TaggedOrder[], current: Scheme): GeoStats;
```
- "Free" reuses the same rule as `curveStats`: `tierCost(current[tier], gross) === 0`.
- `MIN_COUNTRY_N = 5` (deep-dive parity) applied in the UI, not the stats (keep stats complete; the component slices). `log()`-style note in the UI: "countries with ≥5 orders shown" so small markets aren't silently dropped.
- Returns `{ byRegion: [], byCountry: [], hasCountry: false }` when no country data.

**Tests:** region rollup sums; AOV/median/freePct per group on a known fixture; unknown country → "Other"; empty/no-country → hasCountry false.

## Task 3: UI — Market Mix section

**Files:** new `components/simulator/report/MarketMix.tsx`; wire into `ComparisonReport` after `CurveAnatomy`; thread `geoStats` from `StepProposal`.

- **Region snapshot:** one row per region — orders, AOV, median, free-ship %.
- **Country table:** sortable (orders / AOV / median / GMV / free %), filtered to n ≥ 5, region pill per row. Mirror the deep-dive's section 04 layout in tac tokens.
- Collapsible on screen / expanded in PDF, same pattern as `CurveAnatomy`.
- **Render only when `geoStats.hasCountry`** — older/summary exports without a country column simply omit the section (no empty state, no error).

## Out of scope

- Per-market scheme optimisation / market-aware recommendations.
- Currency conversion or multi-currency uploads (the one-market rule stands).
- City/province drill-down (province is captured-adjacent but not surfaced; revisit only if asked).

## Open questions for Damo

1. **Region buckets** — UK / EU / EFTA / NA / ANZ / Other enough, or do you want a specific cut (e.g. split Nordics, or AU domestic separately)?
2. **Section placement** — after Curve Anatomy (recommend), or up near the KPI strip as part of the "shape of the book" story?
3. **Min country size** — show countries with ≥5 orders (deep-dive parity) or surface all with a low-n caveat?

## Verify

- `npx vitest run lib/shipping-sim` green (existing 150 + parser country + geo tests).
- `npm run build` green.
- Browser: drive the UK/EU file end-to-end; confirm the section renders with GB/DE/FR/etc and hides when a no-country CSV is uploaded.

## Effort

Parser/type change + one stats module + a region data map + one report component + wiring + tests. Slightly larger than curve anatomy because it touches the parser contract, but still self-contained — no change to the recommendation engine.
