-- Adds parent linkage + brief diff metadata for agent-driven re-runs.
-- When the chat agent commits a brief change, the new analysis row links back
-- to the original via parent_analysis_id, and brief_changes captures the diff
-- so consultants can trace why a re-run produced different numbers.

alter table public.freight_analyses
  add column if not exists parent_analysis_id uuid references public.freight_analyses(id) on delete set null,
  add column if not exists brief_changes jsonb,
  add column if not exists rerun_rationale text;

create index if not exists freight_analyses_parent_idx
  on public.freight_analyses(parent_analysis_id);
