-- Account hardening. Run once in the Supabase SQL editor (after migration-5.sql). Safe to run again.
--
-- 1. "Home" moves out of the account's user_metadata into its own table. user_metadata is copied into every sign-in token
--    and can be read after the password alone (before the two-step code); this table needs the two-step code like trips do.
-- 2. The "no account for that email" message of share_trip no longer says whether an account exists.
-- 3. Reading your own uploaded pictures needs the two-step code too, like adding and removing them.

create table if not exists public.user_home (
  user_id uuid primary key references auth.users (id) on delete cascade,
  home jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.user_home enable row level security;

drop policy if exists user_home_own on public.user_home;
create policy user_home_own on public.user_home for all to authenticated
  using (public.is_two_step() and user_id = auth.uid())
  with check (public.is_two_step() and user_id = auth.uid());
revoke all on public.user_home from anon;
grant select, insert, update, delete on public.user_home to authenticated;

-- copy the home you already set, then take it out of user_metadata
insert into public.user_home (user_id, home)
select id, raw_user_meta_data -> 'home' from auth.users
where jsonb_typeof(raw_user_meta_data -> 'home') = 'object'
on conflict (user_id) do nothing;

update auth.users set raw_user_meta_data = raw_user_meta_data - 'home' where raw_user_meta_data ? 'home';

-- share_trip: same checks as before, with an answer that does not confirm which emails have accounts
create or replace function public.share_trip(p_trip uuid, p_email text, p_role text default 'partner') returns void
language plpgsql security definer set search_path = public, auth as $$
declare partner uuid;
begin
  if not (public.is_two_step() and public.is_owner(p_trip)) then raise exception 'Only the trip owner can share it'; end if;
  if p_role <> 'partner' then raise exception 'Unknown role'; end if;
  select id into partner from auth.users where lower(email) = lower(trim(p_email));
  if partner is null or partner = auth.uid() then
    raise exception 'Could not add that person. Check the address, and that you have created their account in Supabase (Authentication, Users).';
  end if;
  insert into public.trip_members (trip_id, user_id, role) values (p_trip, partner, 'partner')
    on conflict (trip_id, user_id) do update set role = excluded.role;
end $$;

revoke all on function public.share_trip(uuid, text, text) from public, anon;
grant execute on function public.share_trip(uuid, text, text) to authenticated;

-- pictures: owner reads need the two-step code as well
drop policy if exists "photos: owner reads" on storage.objects;
create policy "photos: owner reads" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text and public.is_two_step());
