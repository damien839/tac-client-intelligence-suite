---
title: Data Model
date: 2026-05-07
tags: [claude]
project: personal
status: active
type: note
---

# Data Model — what the analyzer reads

The analyzer pulls all input from Supabase Postgres. Every read is **scoped to the active tenant** (`tenant_id` filter). The analyzer must never query across tenants.

## Tables

### `tenants`
| Column | Type | Used for |
|--------|------|----------|
| `id` | uuid | tenant scope |
| `name` | text | report header |
| `kind` | enum (`client` \| `prospect`) | report tone (prospects get more upfront pitch language) |
| `currency` | text | currency formatting (always shown but reports labelled in this currency) |

### `carriers`
| Column | Type | Used for |
|--------|------|----------|
| `id` | uuid | join key |
| `name` | text | display |
| `code` | text | matching / fuzzy lookups |

### `freight_shipment_volumes` (CURRENT VOLUME + CHARGES)
The core "what's happening today" table.

| Column | Type | Used for |
|--------|------|----------|
| `tenant_id` | uuid | scope |
| `carrier_id` | uuid → `carriers` | grouping |
| `service_level` | text | grouping (e.g. "Standard", "Express") |
| `zone_label` | text | regional axis (e.g. "Metro NSW", "Regional VIC", "Remote") |
| `monthly_shipments` | numeric | volume |
| `avg_charge_aud` | numeric | current cost per parcel |
| `avg_weight_kg` | numeric \| null | weight inputs for cube estimation |
| `period_label` | text \| null | display label e.g. "Mar 2026" |
| `period_start`, `period_end` | date \| null | analysis period |

**Derived per row**:
- `monthly_spend = monthly_shipments × avg_charge_aud`
- `annualised_spend = monthly_spend × 12`

### `freight_rate_cards`
| Column | Type | Used for |
|--------|------|----------|
| `tenant_id` | uuid | scope |
| `carrier_id` | uuid | match against volume rows |
| `service_level` | text | match against volume rows |
| `status` | enum (`current` \| `new` \| `archived`) | which set this card belongs to |
| `label` | text \| null | display |
| `effective_from`, `effective_to` | date \| null | period flag |
| `fuel_surcharge_percent` | numeric \| null | applied to projected rate (currently informational only) |
| `surcharges_json` | jsonb \| null | NOT YET MODELLED — surface as warning |

### `freight_rate_card_lines`
| Column | Type | Used for |
|--------|------|----------|
| `rate_card_id` | uuid | parent card |
| `zone_label` | text | match against volume `zone_label` |
| `weight_min_kg`, `weight_max_kg` | numeric \| null | weight bracket |
| `rate_basis` | enum (`per_parcel` \| `per_kg` \| `per_parcel_plus_per_kg`) | which formula to apply |
| `rate_aud` | numeric | base rate |
| `per_kg_rate_aud` | numeric \| null | only for `per_parcel_plus_per_kg` |
| `minimum_charge_aud` | numeric \| null | floor for the line |

## Matching rules — volume row → rate card line

For each volume row, find the matching line in the relevant rate card (current + new) by:

1. Filter rate cards to `tenant_id` + `carrier_id` + `service_level`
2. From those cards' lines, pick the line where:
   - `zone_label` matches volume's `zone_label` (case-insensitive, fuzzy on whitespace)
   - The volume's `avg_weight_kg` falls within the line's `[weight_min_kg, weight_max_kg]` bracket
3. If no exact zone match: fuzzy match on zone_label (e.g. volume "Metro" matches line "Metro NSW" if no closer match exists)
4. If no weight bracket match: pick the line where `weight_min_kg <= avg_weight_kg`, lowest available — and surface a warning
5. If still no match: skip this row in projections, surface as `unmatched_volumes` warning

## Computing projected charge per parcel

Given a matched rate card line and a volume row's `avg_weight_kg`:

```
basis = line.rate_basis
weight = volume.avg_weight_kg

if basis == 'per_parcel':
    projected = line.rate_aud
elif basis == 'per_kg':
    projected = line.rate_aud * weight
elif basis == 'per_parcel_plus_per_kg':
    projected = line.rate_aud + (line.per_kg_rate_aud * weight)

if line.minimum_charge_aud is not null:
    projected = max(projected, line.minimum_charge_aud)

# Apply fuel surcharge if defined on the rate card
if card.fuel_surcharge_percent is not null:
    projected = projected * (1 + card.fuel_surcharge_percent / 100)
```

This is the **projected charge per parcel** that goes into all savings calculations.