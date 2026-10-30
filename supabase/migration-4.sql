-- TraiLilo migration 4: travel partners. Run once in Supabase → SQL Editor, after schema.sql, migration-2.sql and migration-3.sql.
-- A trip can now be shared in two ways:
--   friend  : sees the friends' version (read-only), as before
--   partner : sees and edits the full version, same as the owner (but cannot share, unshare or delete the trip)

alter table public.trip_members add column if not exists role text not null default 'friend';
alter table public.trip_members drop constraint if exists trip_members_role_check;
alter table public.trip_members add constraint trip_members_role_check check (role in ('friend', 'partner'));

-- the owner, or a partner
create or replace function public.is_editor(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner(t) or exists (select 1 from public.trip_members where trip_id = t and user_id = auth.uid() and role = 'partner')
$$;

-- partners may read the full version (writes still only go through save_trip below)
drop policy if exists private_partner_read on public.trip_private;
create policy private_partner_read on public.trip_private for select to authenticated
  using (public.is_two_step() and public.is_editor(trip_id));

-- saving: owner or partner
create or replace function public.save_trip(
  p_trip uuid, p_version int, p_title text, p_cover text, p_start date, p_end date, p_public jsonb, p_private jsonb
) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not (public.is_two_step() and public.is_editor(p_trip)) then raise exception 'Only the owner or a travel partner can save'; end if;
  update public.trips
     set title = p_title, cover_region = p_cover, start_date = p_start, end_date = p_end,
         data = p_public, version = version + 1
   where id = p_trip and version = p_version
   returning version into v;
  if v is null then raise exception 'This trip was changed on another device. Reload to see the latest, then edit again.'; end if;
  insert into public.trip_private (trip_id, data) values (p_trip, p_private)
    on conflict (trip_id) do update set data = excluded.data;
  return v;
end $$;

-- sharing: choose the role (owner only). Sharing again with another role changes it.
drop function if exists public.share_trip(uuid, text);
create or replace function public.share_trip(p_trip uuid, p_email text, p_role text default 'friend') returns void
language plpgsql security definer set search_path = public, auth as $$
declare friend uuid;
begin
  if not (public.is_two_step() and public.is_owner(p_trip)) then raise exception 'Only the trip owner can share it'; end if;
  if p_role not in ('friend', 'partner') then raise exception 'Unknown role'; end if;
  select id into friend from auth.users where lower(email) = lower(trim(p_email));
  if friend is null then raise exception 'No account for that email yet. Add them in Supabase first (Authentication, Users).'; end if;
  if friend = auth.uid() then raise exception 'That is you'; end if;
  insert into public.trip_members (trip_id, user_id, role) values (p_trip, friend, p_role)
    on conflict (trip_id, user_id) do update set role = excluded.role;
end $$;

-- who has access (owner only)
create or replace function public.list_members(p_trip uuid) returns table (email text, role text)
language plpgsql security definer set search_path = public, auth as $$
begin
  if not (public.is_two_step() and public.is_owner(p_trip)) then raise exception 'Only the trip owner can see this'; end if;
  return query select u.email::text, m.role from public.trip_members m join auth.users u on u.id = m.user_id where m.trip_id = p_trip order by m.created_at;
end $$;

revoke all on function public.share_trip(uuid, text, text), public.list_members(uuid), public.is_editor(uuid) from public, anon;
grant execute on function public.share_trip(uuid, text, text), public.list_members(uuid), public.is_editor(uuid) to authenticated;
