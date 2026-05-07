---
title: Metrics
date: 2026-05-07
tags: [claude]
project: personal
status: active
type: note
---

# Metrics — formulas and computation rules

Every number in the report comes from one of the formulas below. **The report-mode prompt instructs Claude to follow this file verbatim.** If a formula needs to change, edit it here.

All currency values are in AUD (or the tenant's `currency` if different). Round currency to whole dollars in headlines, two decimals in detail tables. Percentages to one decimal place.

---

## 1. Volume analysed

```
total_monthly_shipments = sum(volume.monthly_shipments)
total_annualised_shipments = total_monthly_shipments * 12

period_analysed = the most common period_label across volume rows,
                  or the date range [min(period_start), max(period_end)],
                  or "current snapshot" if no period info
```

Surface in the report header alongside the tenant name.

---

## 2. Cost Per Order (CPO)

The most-quoted client metric. Calculated two ways:

### Current CPO
```
current_cpo = sum(volume.monthly_shipments * volume.avg_charge_aud)
              / sum(volume.monthly_shipments)
```
Weighted average across the whole shipment mix.

### Projected CPO (under the new rate card)
```
projected_cpo = sum(volume.monthly_shipments * projected_charge_per_parcel)
                / sum(volume.monthly_shipments)
```
Where `projected_charge_per_parcel` is computed per [`data-model.md`](./data-model.md) matching rules. Volume rows with no matching line are **excluded from this average** — they're flagged in the warnings section but don't pollute the CPO.

### CPO delta
```
cpo_delta_aud = current_cpo - projected_cpo
cpo_delta_pct = cpo_delta_aud / current_cpo * 100
```

Positive delta = saving. Negative = the new card is more expensive.

---

## 3. Total spend — current vs projected

### Current monthly spend
```
current_monthly_spend = sum(volume.monthly_shipments * volume.avg_charge_aud)
current_annual_spend = current_monthly_spend * 12
```

### Projected monthly spend
```
projected_monthly_spend = sum(volume.monthly_shipments * projected_charge_per_parcel)
                          + spend_on_unmatched_rows  // see below
projected_annual_spend = projected_monthly_spend * 12
```

**Treatment of unmatched rows**: if a volume row has no matching rate-card line, hold its current charge constant — i.e. assume no change. This avoids fake savings from coverage gaps and makes the warning honest.

```
spend_on_unmatched_rows = sum(volume.monthly_shipments * volume.avg_charge_aud)
                          for volumes with no matching new rate-card line
```

### Total savings
```
monthly_savings = current_monthly_spend - projected_monthly_spend
annual_savings = monthly_savings * 12
savings_pct = monthly_savings / current_monthly_spend * 100
```

---

## 4. State / region breakdown

The analyzer needs a per-region table even though the schema doesn't yet have a `state` column.

### Inference rule (until schema adds `state`)
1. Look at `zone_label` and `zone_description` (rate-card line). If either contains an Australian state code (`NSW|VIC|QLD|WA|SA|TAS|NT|ACT`) or full name, classify the row to that state.
2. If the zone is "Metro" / "Regional" / "Remote" without a state qualifier, classify as `Unmapped`.
3. Group all `Unmapped` rows separately so the consultant knows the gap.

### Per-region metrics
For each region group:
```
region_shipments = sum of volume.monthly_shipments in that region
region_current_spend = sum of volume.monthly_shipments * avg_charge_aud
region_projected_spend = sum of volume.monthly_shipments * projected_charge_per_parcel
region_savings = region_current_spend - region_projected_spend
region_savings_pct = region_savings / region_current_spend * 100
region_share_pct = region_shipments / total_monthly_shipments * 100
```

Sort the table by `region_current_spend` desc.

---

## 5. Cubic meter analysis

Until a real `avg_cube_m3` field is added, estimate from weight using a working assumption.

### Default density assumption
```
DEFAULT_DENSITY_KG_PER_M3 = 200  // typical apparel/light-goods carton
```
Editable here. Override per tenant via the chat ("treat this client at 250 kg/m³").

### Cube per parcel
```
estimated_cube_m3 = avg_weight_kg / DEFAULT_DENSITY_KG_PER_M3
```

### Total cube shipped
```
total_monthly_cube_m3 = sum(volume.monthly_shipments * estimated_cube_m3)
total_annual_cube_m3 = total_monthly_cube_m3 * 12
```

### Cost per cubic meter
```
cost_per_m3_current = current_monthly_spend / total_monthly_cube_m3
cost_per_m3_projected = projected_monthly_spend / total_monthly_cube_m3
```

### Volumetric weight (DIM weight) check
Most carriers use 250 kg/m³ as their dimensional divisor. If a parcel's actual weight is below its DIM weight, the carrier bills on DIM. Flag rows where:
```
estimated_dim_weight = (avg_weight_kg / DEFAULT_DENSITY_KG_PER_M3) * 250
if estimated_dim_weight > avg_weight_kg * 1.2:
    flag as "DIM-billed" risk
```

This signals where the tenant might be paying volumetric rates without realising. Surface in the cube section with the affected lanes.

---

## 6. Top savings opportunities

Rank carrier/service combinations by absolute annual savings.

```
for each (carrier, service) in volume rows:
    sum its monthly_savings
    multiply by 12 for annual
    sort desc
    take top 5
```

For each opportunity, also compute the per-parcel delta and how many parcels per month it touches. This drives the savings waterfall chart.

---

## 7. Confidence score

A 0-100 score reflecting how much of the volume the new card covers cleanly.

```
matched_volume_pct = sum(matched_row.monthly_shipments) / total_monthly_shipments * 100
weight_data_pct = sum(rows_with_weight.monthly_shipments) / total_monthly_shipments * 100
zone_state_pct = sum(rows_with_state.monthly_shipments) / total_monthly_shipments * 100

confidence = 0.5 * matched_volume_pct
           + 0.3 * weight_data_pct
           + 0.2 * zone_state_pct
```

Display alongside the headline savings number. Below 70 = warn the consultant, the report is directional not precise.

---

## Editing conventions

- **All formulas are pseudo-code, not Python.** The report-mode prompt expects Claude to apply them to the supplied data; the analyzer page does not execute these directly. (When we add a deterministic compute layer, it'll mirror these formulas.)
- **Add a new metric**: add a numbered section here, then update `references/report-structure.md` to place it in a section, then update `schemas/report.schema.json` to expose it in the payload.
- **Change a default constant** (like `DEFAULT_DENSITY_KG_PER_M3`): edit the value here. The prompt re-reads it on each invocation.