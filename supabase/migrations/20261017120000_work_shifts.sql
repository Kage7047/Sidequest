-- Work shifts: who works when, where, and for what hourly rate. Both of you can see and
-- edit each other's shifts; pay is worked out in the app from hours × rate.
create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  person uuid not null references auth.users(id) on delete cascade,
  job text not null default '' check (char_length(job) <= 120),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  break_minutes integer not null default 0 check (break_minutes between 0 and 600),
  hourly_rate numeric(10,2) check (hourly_rate is null or hourly_rate >= 0),
  note text check (note is null or char_length(note) <= 1000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at - starts_at <= interval '24 hours')
);
create index if not exists shifts_space_start_idx on public.shifts (space_id, starts_at);
alter table public.shifts enable row level security;
grant select, insert, update, delete on public.shifts to authenticated;

drop policy if exists "Members can view shifts" on public.shifts;
drop policy if exists "Members can add shifts" on public.shifts;
drop policy if exists "Members can update shifts" on public.shifts;
drop policy if exists "Members can delete shifts" on public.shifts;
create policy "Members can view shifts" on public.shifts for select to authenticated using (private.is_space_member(space_id));
create policy "Members can add shifts" on public.shifts for insert to authenticated with check (private.is_space_member(space_id) and created_by = (select auth.uid()));
create policy "Members can update shifts" on public.shifts for update to authenticated using (private.is_space_member(space_id)) with check (private.is_space_member(space_id));
create policy "Members can delete shifts" on public.shifts for delete to authenticated using (private.is_space_member(space_id));

create or replace function public.ensure_shift_person_is_member()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.space_members sm
    where sm.space_id = new.space_id and sm.user_id = new.person
  ) then
    raise exception 'The shift person must belong to this shared space.';
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.ensure_shift_person_is_member() from public, anon;
grant execute on function public.ensure_shift_person_is_member() to authenticated;
drop trigger if exists ensure_shift_person_is_member on public.shifts;
create trigger ensure_shift_person_is_member
before insert or update on public.shifts
for each row execute function public.ensure_shift_person_is_member();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shifts') then
    alter publication supabase_realtime add table public.shifts;
  end if;
end;
$$;
