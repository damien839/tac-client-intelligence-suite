-- ─────────────────────────────────────────────────────────────────
-- shipment_volumes_unified — read-side view that lets analyzer code
-- pretend everything is one summary table.
--
-- Two data sources coexist:
--   1. freight_shipment_volumes (manual_csv): pre-aggregated rows the
--      user typed in via the CSV template. No line-level data.
--   2. shipment_lines (billing_extract): per-shipment rows from carrier
--      billing exports. Aggregated on-the-fly to match the shape of (1).
--
-- The view UNIONs both. Analyzer reads from this; writers continue to
-- target the underlying tables.
--
-- Why a view, not materialized: aggregating ~50k lines is sub-100ms in
-- Postgres, and we never want stale numbers when the user just uploaded
-- a file. Re-evaluate if line counts grow past a few million.
-- ─────────────────────────────────────────────────────────────────

create or replace view public.shipment_volumes_unified as
-- Manual CSV path: passthrough of the existing summary table.
select
  v.id,
  v.tenant_id,
  v.carrier_id,
  v.service_level,
  v.zone_label,
  v.monthly_shipments,
  v.avg_charge_aud,
  v.avg_weight_kg,
  v.period_label,
  v.period_start,
  v.period_end,
  v.source,
  v.source_upload_id,
  v.notes,
  v.created_at,
  v.updated_at
from public.freight_shipment_volumes v

union all

-- Billing-extract path: aggregate lines into the same shape. One row
-- per (tenant × carrier × service × resolved_zone × upload). Keeping
-- upload_id in the GROUP BY means each upload contributes its own
-- summary row — analyzer can still tell uploads apart, and re-uploading
-- the same data doesn't double-count silently.
select
  -- Synthesise a stable id by hashing the grouping key. Not a real
  -- pkey — the view is read-only. Postgres uuid v5-ish via md5.
  (
    'a0000000-0000-0000-0000-' ||
    substring(
      md5(
        coalesce(l.upload_id::text, '') || '|' ||
        l.carrier_id::text || '|' ||
        coalesce(l.service_level, '') || '|' ||
        coalesce(l.resolved_zone, '')
      ), 1, 12
    )
  )::uuid as id,
  l.tenant_id,
  l.carrier_id,
  coalesce(l.service_level, 'Standard') as service_level,
  coalesce(l.resolved_zone, 'Unknown') as zone_label,
  count(*)::numeric(10,2) as monthly_shipments,
  (avg(l.charge_aud))::numeric(10,2) as avg_charge_aud,
  case when count(l.weight_kg) > 0
    then (avg(l.weight_kg))::numeric(8,3)
    else null
  end as avg_weight_kg,
  null::text as period_label,
  min(l.ship_date) as period_start,
  max(l.ship_date) as period_end,
  'billing_extract'::public.volume_source as source,
  l.upload_id as source_upload_id,
  null::text as notes,
  min(l.created_at) as created_at,
  max(l.created_at) as updated_at
from public.shipment_lines l
group by l.tenant_id, l.carrier_id, l.service_level, l.resolved_zone, l.upload_id;

-- Views inherit RLS from their underlying tables. Both
-- freight_shipment_volumes and shipment_lines have authenticated_full_access
-- policies, so authenticated reads work without extra grants.

comment on view public.shipment_volumes_unified is
  'Unified read view over freight_shipment_volumes (manual) and shipment_lines (billing). Use for any analyzer / dashboard read.';
