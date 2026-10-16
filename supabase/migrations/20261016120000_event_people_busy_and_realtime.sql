-- Who an event is for. Null means both of you.
alter table public.events add column if not exists person uuid references auth.users(id) on delete set null;

create or replace function public.ensure_event_person_is_member()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.person is not null and not exists (
    select 1 from public.space_members sm
    where sm.space_id = new.space_id and sm.user_id = new.person
  ) then
    raise exception 'The event person must belong to this shared space.';
  end if;
  return new;
end;
$$;

revoke all on function public.ensure_event_person_is_member() from public, anon;
grant execute on function public.ensure_event_person_is_member() to authenticated;
drop trigger if exists ensure_event_person_is_member on public.events;
create trigger ensure_event_person_is_member
before insert or update of person, space_id on public.events
for each row execute function public.ensure_event_person_is_member();

-- The partner's private events as time blocks only (no title, place or note), so each of
-- you can see when the other is busy without seeing what it is.
create or replace function public.partner_busy(p_space_id uuid)
returns table (id uuid, starts_at timestamptz, ends_at timestamptz, all_day boolean, created_by uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.starts_at, e.ends_at, e.all_day, e.created_by
  from public.events e
  where e.space_id = p_space_id
    and private.is_space_member(p_space_id)
    and e.visibility = 'personal'
    and e.created_by <> (select auth.uid())
    and coalesce(e.ends_at, e.starts_at) >= pg_catalog.now() - interval '120 days';
$$;

revoke all on function public.partner_busy(uuid) from public, anon;
grant execute on function public.partner_busy(uuid) to authenticated;

-- Live updates: the app refreshes when the other person changes something.
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array['events', 'tasks', 'projects', 'goals', 'shared_lists', 'shared_list_items', 'shared_ideas'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
