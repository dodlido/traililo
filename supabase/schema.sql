-- TraiLilo database. Paste this whole file into Supabase → SQL Editor → Run.
-- Rules in short:
--   * nobody reads anything unless they are signed in AND have passed the two-step code (aal2)
--   * a trip is visible to its owner and to people it was shared with
--   * the full version (bookings, to-dos, notes) lives in trip_private and only the owner can read it

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  cover_region text not null default 'Torres del Paine',
  start_date date,
  end_date date,
  data jsonb not null,             -- the friends' version: { trip, tracks }
  created_at timestamptz not null default now()
);

create table if not exists public.trip_private (
  trip_id uuid primary key references public.trips (id) on delete cascade,
  data jsonb not null              -- the full version: { trip, report, sources }
);

create table if not exists public.trip_members (
  trip_id uuid not null references public.trips (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

alter table public.trips enable row level security;
alter table public.trip_private enable row level security;
alter table public.trip_members enable row level security;

create or replace function public.is_two_step() returns boolean
language sql stable as $$ select coalesce(auth.jwt() ->> 'aal', '') = 'aal2' $$;

create or replace function public.is_owner(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trips where id = t and owner_id = auth.uid())
$$;

create or replace function public.is_member(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner(t) or exists (select 1 from public.trip_members where trip_id = t and user_id = auth.uid())
$$;

drop policy if exists trips_read on public.trips;
create policy trips_read on public.trips for select to authenticated
  using (public.is_two_step() and public.is_member(id));

drop policy if exists trips_write on public.trips;
create policy trips_write on public.trips for all to authenticated
  using (public.is_two_step() and owner_id = auth.uid())
  with check (public.is_two_step() and owner_id = auth.uid());

drop policy if exists private_owner on public.trip_private;
create policy private_owner on public.trip_private for all to authenticated
  using (public.is_two_step() and public.is_owner(trip_id))
  with check (public.is_two_step() and public.is_owner(trip_id));

drop policy if exists members_read on public.trip_members;
create policy members_read on public.trip_members for select to authenticated
  using (public.is_two_step() and (user_id = auth.uid() or public.is_owner(trip_id)));

-- Share a trip with a friend who already has an account (owner only).
create or replace function public.share_trip(p_trip uuid, p_email text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare friend uuid;
begin
  if not (public.is_two_step() and public.is_owner(p_trip)) then raise exception 'Only the trip owner can share it'; end if;
  select id into friend from auth.users where lower(email) = lower(trim(p_email));
  if friend is null then raise exception 'No account for that email yet. Invite them from Supabase first.'; end if;
  insert into public.trip_members (trip_id, user_id) values (p_trip, friend) on conflict do nothing;
end $$;

create or replace function public.unshare_trip(p_trip uuid, p_email text) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not (public.is_two_step() and public.is_owner(p_trip)) then raise exception 'Only the trip owner can do that'; end if;
  delete from public.trip_members where trip_id = p_trip and user_id in (select id from auth.users where lower(email) = lower(trim(p_email)));
end $$;

revoke all on function public.share_trip(uuid, text), public.unshare_trip(uuid, text) from public, anon;
grant execute on function public.share_trip(uuid, text), public.unshare_trip(uuid, text) to authenticated;
