-- TraiLilo migration 5: no friends' view. Run once in Supabase → SQL Editor, after migration-4.sql.
-- A trip is now either yours, or shared with a travel partner who sees and edits all of it.
-- There is no read-only copy any more, so:
--   * anyone who was shared a trip as a "friend" loses access (they only ever saw the friends' version)
--   * the old friends' version stored in trips.data is removed; only the map tracks stay there
--   * the only role left is 'partner'
-- See docs/decisions.md for why.

delete from public.trip_members where role = 'friend';

alter table public.trip_members drop constraint if exists trip_members_role_check;
alter table public.trip_members add constraint trip_members_role_check check (role = 'partner');
alter table public.trip_members alter column role set default 'partner';

update public.trips set data = jsonb_build_object('tracks', coalesce(data -> 'tracks', '{}'::jsonb));

drop function if exists public.share_trip(uuid, text, text);
create or replace function public.share_trip(p_trip uuid, p_email text, p_role text default 'partner') returns void
language plpgsql security definer set search_path = public, auth as $$
declare partner uuid;
begin
  if not (public.is_two_step() and public.is_owner(p_trip)) then raise exception 'Only the trip owner can share it'; end if;
  if p_role <> 'partner' then raise exception 'Unknown role'; end if;
  select id into partner from auth.users where lower(email) = lower(trim(p_email));
  if partner is null then raise exception 'No account for that email yet. Add them in Supabase first (Authentication, Users).'; end if;
  if partner = auth.uid() then raise exception 'That is you'; end if;
  insert into public.trip_members (trip_id, user_id, role) values (p_trip, partner, 'partner')
    on conflict (trip_id, user_id) do update set role = excluded.role;
end $$;

revoke all on function public.share_trip(uuid, text, text) from public, anon;
grant execute on function public.share_trip(uuid, text, text) to authenticated;
