-- ─────────────────────────────────────────────────────────────────
-- carrier_postcode_coverage — per-carrier, per-service postcode coverage
--
-- Mirrors the ECX multi-carrier app's effective-rate footprint into
-- TAC CIS so analyzers/rate-card validators can answer:
--   "For postcode X, which carriers can deliver?"
--
-- Source: ECX `carrier_rates` (effective_to is null, is_void = false)
-- aggregated to (carrier_code, service_code, postcode). Postcode is a
-- soft link to postcode_zones.postcode (4-char zero-padded). No hard
-- FK because ECX may cover postcodes outside our zone-master snapshot.
--
-- Refreshed via `scripts/sync-carrier-coverage.mjs`.
-- ─────────────────────────────────────────────────────────────────

create table if not exists public.carrier_postcode_coverage (
  carrier_code text not null,
  service_code text not null,
  postcode text not null,
  is_covered boolean not null default true,
  rate_count integer,
  min_cost_aud numeric(10,2),
  max_cost_aud numeric(10,2),
  source text not null default 'ecx-mirror',
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (carrier_code, service_code, postcode)
);

create index if not exists carrier_coverage_postcode_idx
  on public.carrier_postcode_coverage (postcode);

create index if not exists carrier_coverage_carrier_idx
  on public.carrier_postcode_coverage (carrier_code);

create index if not exists carrier_coverage_service_idx
  on public.carrier_postcode_coverage (service_code);

create trigger carrier_postcode_coverage_set_updated_at
before update on public.carrier_postcode_coverage
for each row execute function public.set_updated_at();

alter table public.carrier_postcode_coverage enable row level security;

create policy "carrier_coverage_authenticated_read"
  on public.carrier_postcode_coverage
  for select to authenticated using (true);

create policy "carrier_coverage_service_role_write"
  on public.carrier_postcode_coverage
  for all to service_role using (true) with check (true);
