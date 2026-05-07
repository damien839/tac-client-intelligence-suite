---
title: Sanity Checks
date: 2026-05-07
tags: [claude]
project: personal
status: active
type: note
---

# Sanity Checks — when to warn the consultant

The analyzer is client-facing. A bad number in a deck destroys credibility. These checks run on every report generation and are surfaced via the `warnings` section.

Each warning has a **severity**:

- `info` — useful context, not blocking
- `warn` — accuracy is degraded; consultant should review before sharing
- `block` — report should not be shared externally as-is; clearly displayed at top

---

## Volume coverage checks

### `no_volume_data` — block
**Trigger**: zero rows in `freight_shipment_volumes` for the tenant.
**Message**: "No current volume data has been uploaded for this tenant. The analyzer cannot project savings without it. Upload a CSV in Final Mile → Current Volume."

### `low_volume_coverage` — warn
**Trigger**: total monthly shipments < 100 across all carriers.
**Message**: "Total monthly shipments analysed is low ({N}). Small sample sizes amplify projection error — consider gathering a fuller month before sharing externally."

### `unmatched_volumes` — warn
**Trigger**: any volume rows have no matching new rate-card line.
**Message**: "{N} volume row(s) ({pct}% of shipments) couldn't be matched to a new rate-card line. These are held at current cost in the projection. Review the unmatched lanes — they often indicate a missing zone or weight bracket."

### `zero_volume_rows` — info
**Trigger**: any rows with `monthly_shipments = 0`.
**Message**: "{N} volume row(s) have zero shipments and were excluded from the analysis."

---

## Rate-card coverage checks

### `no_new_rate_card` — warn (not block — the report still has value)
**Trigger**: zero rate cards with `status = 'new'` for the tenant.
**Message**: "No new rate card has been loaded. The report shows current spend and a region/cube breakdown, but no projected savings. Upload a new card in Final Mile → New Rate Cards."

### `no_current_rate_card` — info
**Trigger**: zero rate cards with `status = 'current'` for the tenant. (Volume + charges alone is enough to project against a new card.)
**Message**: "No current rate card on file. The current spend baseline is taken from the uploaded volume + charges data only — not from a contracted rate card."

### `incomplete_card_lines` — warn
**Trigger**: a new rate card has fewer than 3 lines, or lines covering fewer than 2 zones.
**Message**: "Rate card '{label}' has limited coverage ({N} lines, {Z} zones). Ensure the full rate matrix has been imported."

### `surcharges_present_but_unmodelled` — info
**Trigger**: any rate card has non-empty `surcharges_json`.
**Message**: "Surcharges are captured but not yet applied to projections. Real billed cost will be higher than the projected number — by typically 5-15% depending on lane mix."

---

## Data quality checks

### `missing_weight_data` — warn
**Trigger**: more than 20% of monthly shipments come from rows without `avg_weight_kg`.
**Message**: "{pct}% of shipments are missing average weight. Cube estimates and weight-based rates use a fallback assumption that may be inaccurate. Add weight data to the volume rows to improve precision."

### `extreme_weight` — info
**Trigger**: any volume row with `avg_weight_kg > 25` or `< 0.05`.
**Message**: "{N} volume row(s) have extreme average weights (<50g or >25kg) — verify these are correct."

### `extreme_charge` — info
**Trigger**: any volume row with `avg_charge_aud > 100` or `< 1`.
**Message**: "{N} volume row(s) have outlier charges (<$1 or >$100) — verify these are correct."

### `regional_unmapped` — info, escalate to warn if >10%
**Trigger**: rows where state can't be inferred from zone fields. Severity = `info` if <10% of shipments, `warn` if ≥10%.
**Message**: "{pct}% of shipments couldn't be assigned to a state. The region breakdown groups them as 'Unmapped'. Add state info to volume rows or zones for state-level reporting."

---

## Carrier consistency checks

### `carrier_mix_changed` — info
**Trigger**: volume rows reference a carrier that has zero rate-card lines in the new card set, AND the new card set has carriers not in the volume data.
**Message**: "The new card set includes carriers ({list}) that aren't in current volume — and current volume includes carriers ({list}) not in the new card set. This is fine if the new card represents a deliberate carrier change, but call it out in the report framing."

### `service_level_mismatch` — warn
**Trigger**: a volume row's `service_level` has no matching rate-card line by name (e.g. volume says "Standard", card says "Express Standard").
**Message**: "Service level '{volume_service}' for {carrier} has no exact match in the new card. Closest match is '{card_service}'. Confirm with the carrier before relying on this projection."

### `large_cpo_swing` — warn
**Trigger**: any (carrier, service) combo where projected CPO differs from current CPO by more than 30%.
**Message**: "Projected CPO for {carrier} {service} swings by {pct}% vs current. Large swings often indicate a zone/weight matching error rather than a real saving. Spot-check the underlying line match."

---

## Confidence floor

If overall confidence score (per `metrics.md` §7) is below 70:

### `low_confidence` — warn
**Trigger**: confidence < 70.
**Message**: "Overall confidence is {N}/100. The report is directionally useful but precision is limited — share with the client as a working draft, not a final number."

If confidence < 50, escalate to `block`:

### `very_low_confidence` — block
**Trigger**: confidence < 50.
**Message**: "Confidence is too low ({N}/100) to share this report externally. Resolve the warnings above (typically: incomplete coverage, missing weights, or unmatched lanes) before re-running."

---

## Editing guidance

To add a new check:
1. Pick a unique `code` (snake_case, used for deduplication).
2. Decide severity. Bias toward `warn` over `block` — blocks should be unambiguous "do not share" signals.
3. Write the trigger in plain English so the prompt can apply it.
4. Write the message with placeholders. Use `{N}`, `{pct}`, `{carrier}`, `{service}` style placeholders — Claude fills them.
5. Run the report on a real tenant and verify the message reads cleanly.