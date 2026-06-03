-- ─────────────────────────────────────────────────────────────────
-- 00013_apply_aliases_to_historical_data.sql
--
-- The 00012 migration backfilled canonical_tier only on rows whose
-- raw service_level was already canonical ("Express", "Standard", …).
-- Aliased labels ("eParcel", "B2C PRIORITY", "Premium Next Flight")
-- were left null, so historical analyses still collapse via the
-- legacy raw-label fallback in matchKey().
--
-- This migration applies the carrier_service_aliases table to every
-- existing row in freight_shipment_volumes and shipment_lines where
-- canonical_tier IS NULL. Tenant overrides win over global aliases.
--
-- Idempotent: re-running is a no-op because the WHERE clause skips
-- rows whose canonical_tier was already resolved.
-- ─────────────────────────────────────────────────────────────────

-- freight_shipment_volumes ── apply tenant overrides first
update public.freight_shipment_volumes v
set canonical_tier = a.canonical_tier
from public.carrier_service_aliases a
where v.canonical_tier is null
  and v.carrier_id = a.carrier_id
  and a.tenant_id = v.tenant_id
  and lower(trim(v.service_level)) = lower(trim(a.raw_label));

-- freight_shipment_volumes ── then global aliases for anything still null
update public.freight_shipment_volumes v
set canonical_tier = a.canonical_tier
from public.carrier_service_aliases a
where v.canonical_tier is null
  and v.carrier_id = a.carrier_id
  and a.tenant_id is null
  and lower(trim(v.service_level)) = lower(trim(a.raw_label));

-- shipment_lines ── tenant overrides first
update public.shipment_lines l
set canonical_tier = a.canonical_tier
from public.carrier_service_aliases a
where l.canonical_tier is null
  and l.carrier_id = a.carrier_id
  and a.tenant_id = l.tenant_id
  and lower(trim(l.service_level)) = lower(trim(a.raw_label));

-- shipment_lines ── then global aliases
update public.shipment_lines l
set canonical_tier = a.canonical_tier
from public.carrier_service_aliases a
where l.canonical_tier is null
  and l.carrier_id = a.carrier_id
  and a.tenant_id is null
  and lower(trim(l.service_level)) = lower(trim(a.raw_label));
