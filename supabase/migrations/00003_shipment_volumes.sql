-- ─────────────────────────────────────────────────────────────────
-- freight_shipment_volumes — current monthly shipment + charge data
-- per (tenant, carrier, service, zone)
-- Sources: manual CSV (phase 1) and billing extract (phase 2)
-- ─────────────────────────────────────────────────────────────────

create type public.volume_source as enum ('manual_csv', 'billing_extract');

create table if not exists public.freight_shipment_volumes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  service_level text not null,                  -- "Standard", "Express", etc.
  zone_label text not null,                     -- carrier's zone naming
  monthly_shipments numeric(10,2) not null check (monthly_shipments >= 0),
  avg_charge_aud numeric(10,2) not null check (avg_charge_aud >= 0),
  avg_weight_kg numeric(8,3),
  period_label text,                            -- e.g. "Mar 2026", "Q1 2026", "FY26"
  period_start date,
  period_end date,
  source public.volume_source not null default 'manual_csv',
  source_upload_id uuid references public.freight_uploads(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index freight_shipment_volumes_tenant_idx
  on public.freight_shipment_volumes (tenant_id, carrier_id, service_level);

create trigger freight_shipment_volumes_set_updated_at
before update on public.freight_shipment_volumes
for each row execute function public.set_updated_at();

alter table public.freight_shipment_volumes enable row level security;

create policy "freight_shipment_volumes_authenticated_full_access"
  on public.freight_shipment_volumes
  for all to authenticated using (true) with check (true);
