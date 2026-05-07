-- Storage bucket for freight uploads (PDFs, Excel, CSV)
-- Private bucket — access only via signed URLs from server.

insert into storage.buckets (id, name, public)
values ('freight-uploads', 'freight-uploads', false)
on conflict (id) do nothing;

create policy "freight_uploads_authenticated_read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'freight-uploads');

create policy "freight_uploads_authenticated_write"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'freight-uploads');

create policy "freight_uploads_authenticated_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'freight-uploads');

create policy "freight_uploads_authenticated_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'freight-uploads');
