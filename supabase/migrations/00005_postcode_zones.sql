-- ─────────────────────────────────────────────────────────────────
-- postcode_zones — master AU postcode → carrier-zone reference
-- Single shared table (NOT tenant-scoped) used to map any postcode
-- to AP base zone, AP Z40, AP Z9/Z6 origin-pair zones, Toll, DHL.
-- Source: master xlsx maintained by TAC freight team.
-- ─────────────────────────────────────────────────────────────────

create table if not exists public.postcode_zones (
  postcode text primary key,                        -- 4-char zero-padded ("0200", "3350")
  ap_base_zone text,                                -- Metro / Capital / Remote
  ap_zone_z40 text,                                 -- e.g. "BR", "N1", "NC"
  toll_zone text,                                   -- e.g. "VIC1", "SYD"
  ap_z9_adl text,
  ap_z9_syd text,
  ap_z6_syd text,
  ap_z6_mel text,
  ap_z9_mel text,
  ap_z6_bne text,
  ap_z9_bne text,
  ap_z6_gld text,
  ap_z9_gld text,
  dhl_zone text,
  dhl_zone_name text,
  source_file text,                                 -- "20260302 - Carrier Zone File and Delivery Targets_MASTER.xlsx"
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists postcode_zones_ap_base_zone_idx on public.postcode_zones (ap_base_zone);
create index if not exists postcode_zones_ap_zone_z40_idx on public.postcode_zones (ap_zone_z40);
create index if not exists postcode_zones_toll_zone_idx on public.postcode_zones (toll_zone);

create trigger postcode_zones_set_updated_at
before update on public.postcode_zones
for each row execute function public.set_updated_at();

alter table public.postcode_zones enable row level security;

create policy "postcode_zones_authenticated_read"
  on public.postcode_zones
  for select to authenticated using (true);

create policy "postcode_zones_service_role_write"
  on public.postcode_zones
  for all to service_role using (true) with check (true);
