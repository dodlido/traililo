-- TraiLilo migration 2: editing. Run once in Supabase → SQL Editor, after schema.sql.
-- Saves go through these functions so the friends' version and the full version always change together,
-- and a version number stops one device overwriting another's newer edit.

alter table public.trips add column if not exists version int not null default 1;

create or replace function public.save_trip(
  p_trip uuid, p_version int, p_title text, p_cover text, p_start date, p_end date, p_public jsonb, p_private jsonb
) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not (public.is_two_step() and public.is_owner(p_trip)) then raise exception 'Only the trip owner can save'; end if;
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

create or replace function public.create_trip(
  p_title text, p_cover text, p_start date, p_end date, p_public jsonb, p_private jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if not public.is_two_step() then raise exception 'Two-step sign-in required'; end if;
  insert into public.trips (owner_id, title, cover_region, start_date, end_date, data)
    values (auth.uid(), p_title, p_cover, p_start, p_end, p_public) returning id into tid;
  insert into public.trip_private (trip_id, data) values (tid, p_private);
  return tid;
end $$;

create or replace function public.delete_trip(p_trip uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_two_step() and public.is_owner(p_trip)) then raise exception 'Only the trip owner can delete it'; end if;
  delete from public.trips where id = p_trip;
end $$;

revoke all on function public.save_trip(uuid, int, text, text, date, date, jsonb, jsonb),
                       public.create_trip(text, text, date, date, jsonb, jsonb),
                       public.delete_trip(uuid) from public, anon;
grant execute on function public.save_trip(uuid, int, text, text, date, date, jsonb, jsonb),
                          public.create_trip(text, text, date, date, jsonb, jsonb),
                          public.delete_trip(uuid) to authenticated;
