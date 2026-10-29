-- Photos you upload from your device. Run once in the Supabase SQL editor (after schema.sql and migration-2.sql).
-- The bucket is public-read, but every file name contains a random id and only appears inside the trip data,
-- which only the trip's members can read. Only the signed-in owner (after 2FA) can add or remove files, in their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "photos: owner adds" on storage.objects;
drop policy if exists "photos: owner reads" on storage.objects;
drop policy if exists "photos: owner removes" on storage.objects;

create policy "photos: owner adds" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text and public.is_two_step());
create policy "photos: owner reads" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos: owner removes" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text and public.is_two_step());
