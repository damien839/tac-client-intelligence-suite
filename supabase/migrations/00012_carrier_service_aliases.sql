-- ─────────────────────────────────────────────────────────────────
-- carrier_service_aliases — map carrier-specific raw labels
-- ("eParcel", "B2C PRIORITY", "Parcel Post w/ Sig") to one of the
-- six canonical service tiers used by rate cards + the engine.
--
-- Aliases are GLOBAL by default (one fact for every tenant) with an
-- optional per-tenant override row. Lookup precedence at intake:
--   1. tenant override (tenant_id = X)
--   2. global alias    (tenant_id is null)
--   3. raw_label already matches a canonical value (case-insensitive)
--   4. null → surfaces in admin UI as "unmapped"
-- ─────────────────────────────────────────────────────────────────

create table if not exists public.carrier_service_aliases (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references public.carriers(id) on delete cascade,
  -- Nullable: null = global default; set = per-tenant override.
  tenant_id uuid references public.tenants(id) on delete cascade,
  raw_label text not null check (length(trim(raw_label)) > 0),
  canonical_tier text not null check (
    canonical_tier in (
      'Express',
      'Standard',
      'Next Day',
      'Same Day',
      'International Express',
      'International Standard'
    )
  ),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One global alias per (carrier, raw_label).
create unique index if not exists carrier_service_aliases_global_uq
  on public.carrier_service_aliases (carrier_id, lower(raw_label))
  where tenant_id is null;

-- One tenant override per (tenant, carrier, raw_label) — sits on top
-- of the global row.
create unique index if not exists carrier_service_aliases_tenant_uq
  on public.carrier_service_aliases (tenant_id, carrier_id, lower(raw_label))
  where tenant_id is not null;

-- Resolver lookup pattern: filter by carrier first, then tenant.
create index if not exists carrier_service_aliases_carrier_idx
  on public.carrier_service_aliases (carrier_id, tenant_id);

create trigger carrier_service_aliases_set_updated_at
before update on public.carrier_service_aliases
for each row execute function public.set_updated_at();

alter table public.carrier_service_aliases enable row level security;

create policy "carrier_service_aliases_authenticated_full_access"
  on public.carrier_service_aliases
  for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────
-- canonical_tier on volume + line tables
-- Resolved from alias at intake. Engine joins on this; raw service_level
-- stays untouched for display + audit.
-- ─────────────────────────────────────────────────────────────────

alter table public.freight_shipment_volumes
  add column if not exists canonical_tier text;

alter table public.shipment_lines
  add column if not exists canonical_tier text;

-- Backfill: where the existing raw service_level is already one of the
-- six canonical values (case-insensitive), copy it across so legacy
-- rows keep matching without re-import.
update public.freight_shipment_volumes
set canonical_tier = case lower(trim(service_level))
  when 'express' then 'Express'
  when 'standard' then 'Standard'
  when 'next day' then 'Next Day'
  when 'same day' then 'Same Day'
  when 'international express' then 'International Express'
  when 'international standard' then 'International Standard'
  else null
end
where canonical_tier is null;

update public.shipment_lines
set canonical_tier = case lower(trim(service_level))
  when 'express' then 'Express'
  when 'standard' then 'Standard'
  when 'next day' then 'Next Day'
  when 'same day' then 'Same Day'
  when 'international express' then 'International Express'
  when 'international standard' then 'International Standard'
  else null
end
where canonical_tier is null;

create index if not exists freight_shipment_volumes_canonical_tier_idx
  on public.freight_shipment_volumes (tenant_id, carrier_id, canonical_tier);

create index if not exists shipment_lines_canonical_tier_idx
  on public.shipment_lines (tenant_id, carrier_id, canonical_tier);

-- ─────────────────────────────────────────────────────────────────
-- Recreate shipment_volumes_unified to surface canonical_tier in both
-- branches. Keep service_level so the existing UI / preview rows stay
-- intact — the engine reads canonical_tier, the UI reads service_level.
-- ─────────────────────────────────────────────────────────────────

drop view if exists public.shipment_volumes_unified;

create view public.shipment_volumes_unified as
-- Manual CSV path: passthrough, including the new canonical_tier column.
select
  v.id,
  v.tenant_id,
  v.carrier_id,
  v.service_level,
  v.canonical_tier,
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

-- Billing-extract path: aggregate lines into the same shape. Group by
-- canonical_tier so two raw labels that map to the same tier collapse
-- correctly, and two that map to different tiers stay split.
select
  (
    'a0000000-0000-0000-0000-' ||
    substring(
      md5(
        coalesce(l.upload_id::text, '') || '|' ||
        l.carrier_id::text || '|' ||
        coalesce(l.service_level, '') || '|' ||
        coalesce(l.canonical_tier, '') || '|' ||
        coalesce(l.resolved_zone, '')
      ), 1, 12
    )
  )::uuid as id,
  l.tenant_id,
  l.carrier_id,
  coalesce(l.service_level, 'Standard') as service_level,
  l.canonical_tier,
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
group by
  l.tenant_id,
  l.carrier_id,
  l.service_level,
  l.canonical_tier,
  l.resolved_zone,
  l.upload_id;

comment on view public.shipment_volumes_unified is
  'Unified read view over freight_shipment_volumes (manual) and shipment_lines (billing). Engine joins on canonical_tier; UI displays service_level.';

-- ─────────────────────────────────────────────────────────────────
-- Seed common AusPost / StarTrack / Aramex global aliases.
-- High-confidence textual matches only — the admin UI surfaces the
-- rest as "unmapped" for the operator to resolve per carrier.
-- ─────────────────────────────────────────────────────────────────

with seed(carrier_code, raw_label, canonical_tier) as (
  values
    -- Australia Post
    ('AUSPOST', 'eParcel',                      'Standard'),
    ('AUSPOST', 'Parcel Post',                  'Standard'),
    ('AUSPOST', 'Parcel Post with Signature',   'Standard'),
    ('AUSPOST', 'Express Post',                 'Express'),
    ('AUSPOST', 'Express Post with Signature',  'Express'),
    ('AUSPOST', 'International Standard',       'International Standard'),
    ('AUSPOST', 'International Express',        'International Express'),
    -- StarTrack
    ('STARTRACK', 'Road Express',               'Standard'),
    ('STARTRACK', 'Premium',                    'Express'),
    ('STARTRACK', 'Premium Next Flight',        'Same Day'),
    -- Aramex (formerly Fastway)
    ('ARAMEX', 'Road Express',                  'Standard'),
    ('ARAMEX', 'Standard Parcel',               'Standard'),
    -- Couriers Please
    ('COURIERS_PLEASE', 'Standard Road',        'Standard'),
    ('COURIERS_PLEASE', 'Express',              'Express'),
    -- Sendle
    ('SENDLE', 'Standard',                      'Standard'),
    ('SENDLE', 'Preferred',                     'Express')
)
insert into public.carrier_service_aliases (carrier_id, tenant_id, raw_label, canonical_tier)
select c.id, null, s.raw_label, s.canonical_tier
from seed s
join public.carriers c on c.code = s.carrier_code
on conflict do nothing;
