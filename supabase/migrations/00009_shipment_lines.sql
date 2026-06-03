-- ─────────────────────────────────────────────────────────────────
-- shipment_lines — per-shipment line storage (one row per parcel)
--
-- This is the analytical primary store for billing extracts. Replaces
-- the lossy summary-only approach in freight_shipment_volumes (which
-- becomes a derived view). Mirrors ECX's reconciliation_lines pattern:
-- postcode is the primary key, carrier zone codes are denormalised at
-- ingest but recomputable from postcode_zones.
--
-- Why line-level: a 4-row summary table lets you compare one zone
-- average vs one rate; a line-level table lets you do per-postcode
-- P&L, weight-band distribution, peak-day patterns, and "cheapest
-- carrier per postcode" optimisation. The depth of analysis the
-- analyzer needs requires the raw lines.
-- ─────────────────────────────────────────────────────────────────

create table if not exists public.shipment_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  upload_id uuid references public.freight_uploads(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,

  -- Service level. Nullable because some carrier exports (e.g. AusPost
  -- APVOL) have no service column — the whole file is implicitly the
  -- contracted service.
  service_level text,

  -- 4-char zero-padded AU postcode. The analytical primary key.
  postcode text not null check (char_length(postcode) = 4),

  -- Zone resolved from postcode_zones at ingest using the carrier's
  -- zone column (ap_base_zone / toll_zone / dhl_zone). Denormalised
  -- for query speed; recomputable. "Unknown" when postcode not in
  -- reference table.
  resolved_zone text,

  -- Money + weight. Charge is required (no point storing a line we
  -- can't cost). Weight is optional — some exports omit it.
  charge_aud numeric(12,2) not null check (charge_aud >= 0),
  weight_kg numeric(8,3) check (weight_kg is null or weight_kg >= 0),

  -- Optional metadata that helps with diagnostics + drill-downs.
  ship_date date,
  consignment text,

  -- Raw row payload from the source file (all columns we didn't map).
  -- Lets us re-derive new fields later without re-uploading.
  raw jsonb,

  created_at timestamptz not null default now()
);

-- Postcode-level analysis is the dominant query shape (cost per
-- postcode, cheapest-carrier-per-postcode, drill-down). Composite
-- index with tenant first matches the access pattern.
create index if not exists shipment_lines_tenant_postcode_idx
  on public.shipment_lines (tenant_id, postcode);

-- Re-aggregation by carrier × service (rebuilding the summary view).
create index if not exists shipment_lines_tenant_carrier_service_idx
  on public.shipment_lines (tenant_id, carrier_id, service_level);

-- Upload-scoped queries (review screen, "delete this upload's lines").
create index if not exists shipment_lines_upload_idx
  on public.shipment_lines (upload_id);

-- Time-series queries (peak days, weekly trend). Partial — many
-- carrier exports omit ship date, no point indexing nulls.
create index if not exists shipment_lines_tenant_ship_date_idx
  on public.shipment_lines (tenant_id, ship_date)
  where ship_date is not null;

alter table public.shipment_lines enable row level security;

create policy "shipment_lines_authenticated_full_access"
  on public.shipment_lines
  for all to authenticated using (true) with check (true);
