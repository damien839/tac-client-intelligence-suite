-- ─────────────────────────────────────────────────────────────────
-- Add Parcel Right to the carriers lookup. Idempotent — uses the same
-- on-conflict guard as the original seed.
-- ─────────────────────────────────────────────────────────────────

insert into public.carriers (name, code) values
  ('Parcel Right', 'PARCEL_RIGHT')
on conflict (code) do nothing;
