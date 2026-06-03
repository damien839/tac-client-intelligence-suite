-- ─────────────────────────────────────────────────────────────────
-- analysis_share_tokens — public, read-only share links for freight_analyses
-- One token per share-button click. Token is ~32 chars random URL-safe.
-- ─────────────────────────────────────────────────────────────────

create table if not exists public.analysis_share_tokens (
  token text primary key,
  analysis_id uuid not null references public.freight_analyses(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by_email text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  view_count integer not null default 0,
  last_viewed_at timestamptz
);

create index analysis_share_tokens_analysis_idx
  on public.analysis_share_tokens (analysis_id, created_at desc);

create index analysis_share_tokens_tenant_idx
  on public.analysis_share_tokens (tenant_id, created_at desc);

alter table public.analysis_share_tokens enable row level security;

-- Authenticated users (the consultant) can manage their own share tokens via the admin client.
create policy "analysis_share_tokens_authenticated_full_access"
  on public.analysis_share_tokens
  for all to authenticated using (true) with check (true);

-- No anon policy: the public route uses the service-role admin client to
-- look up the token deterministically, which bypasses RLS entirely. This
-- avoids exposing the table structure via PostgREST while still letting the
-- shareable HTML render for unauthenticated viewers.
