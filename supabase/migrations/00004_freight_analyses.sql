-- ─────────────────────────────────────────────────────────────────
-- freight_analyses — saved Final Mile Analyzer report runs
-- One row per "Execute Analysis" click; opens in a new tab via slug.
-- ─────────────────────────────────────────────────────────────────

create table if not exists public.freight_analyses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  snapshot_json jsonb not null,                 -- inputs at time of run
  report_json jsonb not null,                   -- validated payload (matches schemas/report.schema.json)
  schema_version text not null default '0.1.0',
  model text,                                   -- claude model used
  tokens_input integer,
  tokens_output integer,
  duration_ms integer,
  notes text,
  created_at timestamptz not null default now()
);

create index freight_analyses_tenant_idx
  on public.freight_analyses (tenant_id, created_at desc);

alter table public.freight_analyses enable row level security;

create policy "freight_analyses_authenticated_full_access"
  on public.freight_analyses
  for all to authenticated using (true) with check (true);
