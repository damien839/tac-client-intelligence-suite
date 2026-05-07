-- ─────────────────────────────────────────────────────────────────
-- TAC Client Intelligence — Freight Analysis Schema
-- Phase 1: tenants + carriers + uploads + rate cards
-- (billing reports deferred to phase 2)
-- ─────────────────────────────────────────────────────────────────

-- helper: updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────
-- tenants — TAC clients + prospects
-- ─────────────────────────────────────────────────────────────────
create type public.tenant_kind as enum ('client', 'prospect');

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind public.tenant_kind not null default 'prospect',
  industry text,
  currency text not null default 'AUD',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

create trigger tenants_set_updated_at
before update on public.tenants
for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────
-- carriers — lookup table, seeded with common AU carriers
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.carriers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.carriers (name, code) values
  ('Australia Post', 'AUSPOST'),
  ('StarTrack', 'STARTRACK'),
  ('Aramex', 'ARAMEX'),
  ('TGE', 'TGE'),
  ('Sendle', 'SENDLE'),
  ('DHL Express', 'DHL_EXPRESS'),
  ('DHL eCommerce', 'DHL_ECOM'),
  ('FedEx', 'FEDEX'),
  ('TNT', 'TNT'),
  ('Couriers Please', 'COURIERS_PLEASE'),
  ('SEKO', 'SEKO'),
  ('Allied Express', 'ALLIED'),
  ('Direct Freight', 'DIRECT_FREIGHT')
on conflict (code) do nothing;

-- ─────────────────────────────────────────────────────────────────
-- freight_uploads — audit trail of every Claude extraction event
-- ─────────────────────────────────────────────────────────────────
create type public.upload_kind as enum ('billing', 'current_rate_card', 'new_rate_card');
create type public.upload_status as enum ('pending', 'extracting', 'review', 'committed', 'rejected', 'failed');
create type public.file_format as enum ('pdf', 'xlsx', 'csv');

create table if not exists public.freight_uploads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid references public.carriers(id) on delete set null,
  upload_kind public.upload_kind not null,
  file_format public.file_format not null,
  file_name text not null,
  storage_path text,                            -- bucket path in Supabase Storage
  status public.upload_status not null default 'pending',
  claude_model text,
  tokens_input integer,
  tokens_output integer,
  extracted_payload jsonb,                      -- raw Claude output (pre-review)
  reviewed_payload jsonb,                       -- post-edit payload (committed)
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index freight_uploads_tenant_idx on public.freight_uploads (tenant_id, created_at desc);
create index freight_uploads_status_idx on public.freight_uploads (status);

create trigger freight_uploads_set_updated_at
before update on public.freight_uploads
for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────
-- freight_rate_cards — covers both "Current" and "New" tabs via status
-- One rate card = one carrier × one service level × one period
-- ─────────────────────────────────────────────────────────────────
create type public.rate_card_status as enum ('current', 'new', 'archived');
create type public.rate_basis as enum ('per_parcel', 'per_kg', 'per_parcel_plus_per_kg');

create table if not exists public.freight_rate_cards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  service_level text not null,                  -- e.g. "Standard", "Express", "Same Day"
  status public.rate_card_status not null default 'new',
  label text,                                   -- user-friendly label e.g. "AusPost Standard FY26"
  effective_from date,
  effective_to date,
  source_upload_id uuid references public.freight_uploads(id) on delete set null,
  fuel_surcharge_percent numeric(5,2),          -- pulled from card if specified
  surcharges_json jsonb,                        -- {residential, oversize, remote, etc.}
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index freight_rate_cards_tenant_idx
  on public.freight_rate_cards (tenant_id, status, carrier_id);

create trigger freight_rate_cards_set_updated_at
before update on public.freight_rate_cards
for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────
-- freight_rate_card_lines — the rate matrix
-- Stored as-supplied (carrier's own zone labels + weight breaks)
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.freight_rate_card_lines (
  id uuid primary key default gen_random_uuid(),
  rate_card_id uuid not null references public.freight_rate_cards(id) on delete cascade,
  zone_label text not null,                     -- carrier's zone naming
  zone_description text,                        -- optional: states/postcodes covered
  weight_min_kg numeric(8,3),                   -- nullable for per_parcel-only rows
  weight_max_kg numeric(8,3),                   -- nullable for open-ended (>X kg) rows
  rate_basis public.rate_basis not null default 'per_parcel',
  rate_aud numeric(10,4) not null,              -- 4dp to support per-kg micro rates
  per_kg_rate_aud numeric(10,4),                -- only for per_parcel_plus_per_kg basis
  minimum_charge_aud numeric(10,2),
  notes text,
  created_at timestamptz not null default now()
);

create index freight_rate_card_lines_card_idx
  on public.freight_rate_card_lines (rate_card_id, zone_label);

-- ─────────────────────────────────────────────────────────────────
-- RLS — single-admin model: authenticated users get full access
-- (anon key ships in JS bundle; RLS is the real lock)
-- ─────────────────────────────────────────────────────────────────
alter table public.tenants enable row level security;
alter table public.carriers enable row level security;
alter table public.freight_uploads enable row level security;
alter table public.freight_rate_cards enable row level security;
alter table public.freight_rate_card_lines enable row level security;

create policy "tenants_authenticated_full_access" on public.tenants
  for all to authenticated using (true) with check (true);

create policy "carriers_authenticated_read" on public.carriers
  for select to authenticated using (true);

create policy "carriers_authenticated_write" on public.carriers
  for all to authenticated using (true) with check (true);

create policy "freight_uploads_authenticated_full_access" on public.freight_uploads
  for all to authenticated using (true) with check (true);

create policy "freight_rate_cards_authenticated_full_access" on public.freight_rate_cards
  for all to authenticated using (true) with check (true);

create policy "freight_rate_card_lines_authenticated_full_access" on public.freight_rate_card_lines
  for all to authenticated using (true) with check (true);
