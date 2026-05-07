---
name: tac-final-mile-analyzer
description: TAC Final Mile freight savings analyzer. Use when a TAC consultant wants to (a) chat with a tenant's freight data — current shipment volume + charges, current rate cards, newly proposed rate cards — to query, sanity-check, or edit values, OR (b) execute a full savings analysis that produces a client-ready report comparing current spend vs projected spend under a new rate card, with state/region breakdown, cost-per-order, and cubic meter analysis. Triggers on phrases like "analyze freight", "compare rate cards", "show savings", "run the analyzer", or any time the consultant is on the Final Mile Analyzer page. Skill is the source of truth for analyzer behaviour — edit it to change metrics, sections, charts, or prompts.
version: 0.1.0
brand: TAC
runtime:
  chat_model: claude-sonnet-4-6
  report_model: claude-sonnet-4-6
  max_tokens_chat: 4096
  max_tokens_report: 16384
  temperature_chat: 0.4
  temperature_report: 0.2
---

# TAC Final Mile Analyzer

Source of truth for the freight savings analyzer used inside the TAC Client Intelligence Suite. The analyzer page reads this file (and the referenced files below) at runtime to drive Claude. **Editing this skill changes runtime behaviour** — no code change required for prompt, metric, or section adjustments.

The analyzer always operates on a **single tenant** at a time (selected via the tenant switcher) and works against three data inputs:

1. **Current Volume + Charges** — what the tenant is shipping today and what they're being charged (`freight_shipment_volumes` table).
2. **Current Rate Card(s)** — the rate cards in effect for this tenant today (`freight_rate_cards` where `status = 'current'` plus their lines).
3. **New Rate Card(s)** — newly proposed rate cards to compare against current (`freight_rate_cards` where `status = 'new'` plus their lines).

If any of these are missing, the analyzer should still run — but it must surface a sanity-check warning (see [`references/sanity-checks.md`](./references/sanity-checks.md)) and degrade gracefully (e.g. skip the savings comparison if no new card is loaded).

---

## Two modes

### 1. Chat mode

A conversational interface where the consultant can:
- Query the data ("what's our current avg cost per parcel for AusPost Standard in Metro?")
- Spot-check coverage ("which carriers are missing volume data?")
- Request edits to volume rows or rate-card lines (the analyzer proposes the change; the consultant confirms before commit)
- Ask for ad-hoc calculations without committing to a full report

System prompt: [`prompts/chat-mode.md`](./prompts/chat-mode.md).

Chat mode has access to **read-only data tools** by default. Edit operations are surfaced as a "proposed change" UI element that requires consultant confirmation before hitting the DB.

### 2. Execute Analysis (Report) mode

A one-shot generation that produces a structured JSON payload conforming to [`schemas/report.schema.json`](./schemas/report.schema.json). The payload includes:
- Header summary (tenant name, period analysed, total volume)
- All required metrics (see [`references/metrics.md`](./references/metrics.md))
- All required sections + chart data (see [`references/report-structure.md`](./references/report-structure.md))
- Sanity-check warnings (see [`references/sanity-checks.md`](./references/sanity-checks.md))
- Recommendations (carrier-level + service-level)

System prompt: [`prompts/report-mode.md`](./prompts/report-mode.md).

The analyzer page persists this payload to the `freight_analyses` table and opens the rendered report in a new browser tab.

---

## Reference files (read these as needed)

| File | When to read |
|------|--------------|
| [`references/data-model.md`](./references/data-model.md) | Mapping from DB tables/columns to the analyzer's input variables. |
| [`references/metrics.md`](./references/metrics.md) | Formulas for every metric in the report (CPO, total spend, savings, etc.). |
| [`references/report-structure.md`](./references/report-structure.md) | Section-by-section spec — order, content, chart type, data shape. |
| [`references/sanity-checks.md`](./references/sanity-checks.md) | Rules for surfacing data quality warnings. |
| [`prompts/chat-mode.md`](./prompts/chat-mode.md) | System prompt for chat mode. |
| [`prompts/report-mode.md`](./prompts/report-mode.md) | System prompt for report-generation mode. |
| [`schemas/report.schema.json`](./schemas/report.schema.json) | JSON schema the report payload must conform to. |

---

## Brand

TAC client-facing — every output (chart colours, copy tone, section ordering) reflects TAC brand:

- **Palette**: Aggregate Teal `#81a0aa` (primary chart colour for "current" series), Aggregate Blue `#2c3e52` (secondary / structure), Aggregate Tiger `#f2663b` (savings + positive deltas), Cream `#f7f4ef`, Tangerine `#f89f5c`, Black `#1c1f20`. Backdrop on dark theme is the existing `tac-bg`.
- **Typography**: Poppins SemiBold for headings, Roboto Light/Regular for body. The analyzer page already loads Poppins via `next/font/google`; report rendering inherits this.
- **Tone**: Operator-first. No fluff. Frame insights as decisions ("recommend switching X to Y, $A annual saving") rather than descriptions ("X is more expensive than Y"). Numbers always with units; currency always AUD; %s with one decimal place.

---

## Editing this skill

This file and everything in `./prompts/`, `./references/`, and `./schemas/` is **intentionally editable without redeploying**. The analyzer page reads from disk on each request (or via revalidate). To adjust behaviour:

- **Tweak a metric formula** → edit `references/metrics.md`. The report prompt instructs Claude to follow this file verbatim.
- **Add or remove a report section** → edit `references/report-structure.md` AND update `schemas/report.schema.json` so the runtime knows what to expect.
- **Change tone or behaviour of chat** → edit `prompts/chat-mode.md`.
- **Tighten or loosen a sanity check** → edit `references/sanity-checks.md`.
- **Switch model or token budget** → edit the `runtime:` block in this frontmatter.

Keep edits backwards-compatible with the JSON schema or update the schema in the same change.

---

## Execution contract (what the analyzer page promises)

When the consultant clicks **Execute Analysis**, the analyzer page must:

1. Snapshot the tenant's current volume rows, current rate cards (with lines), new rate cards (with lines), and any explicit consultant overrides from chat mode.
2. Pass that snapshot to Claude using the report-mode system prompt.
3. Validate the returned JSON against `schemas/report.schema.json` — reject and retry once on schema failure.
4. Persist the validated payload to `freight_analyses` (tenant_id, snapshot_json, report_json, created_at).
5. Open the report URL in a new tab.

When the consultant types in **Chat**, the analyzer page must:

1. Pass the same data snapshot + chat history to Claude using the chat-mode system prompt.
2. Stream the response.
3. If Claude proposes an edit (via a structured `proposed_change` block), render it as a confirm-before-commit UI affordance — never auto-apply.
4. After commit, refresh the data snapshot for subsequent turns.

---

## Known gaps (track these)

These are real data limitations the analyzer must work around today. Each is a planned schema/UX addition; the skill should still be useful before they land.

- **State / region breakdown** — current data has `zone_label` (carrier-defined, e.g. "Metro NSW", "Regional VIC"). True state-level breakdown requires either a `state` column on `freight_shipment_volumes` or a postcode → state mapping. The skill currently uses zone_label as the regional axis and infers state from zone descriptions where possible (see metrics file for the inference rule).
- **Cubic meter analysis** — no `avg_cube_m3` field exists yet. The skill currently estimates cube from `avg_weight_kg` using a default density (see metrics file). Once a real cube field is added, this falls back to direct measurement.
- **Surcharge modelling** — `surcharges_json` on rate cards is captured but not yet computed against. Skill currently ignores surcharges in projections and surfaces a warning.

When any of these gaps is closed, edit the relevant reference file to switch from inference → direct measurement.
