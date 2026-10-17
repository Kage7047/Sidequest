-- Event reminders: "remind me N minutes before". Each occurrence of a repeating event is
-- reminded once; the log row is the claim, so two dispatch runs never send the same one.
alter table public.events add column if not exists remind_minutes integer
  check (remind_minutes is null or remind_minutes between 0 and 10080);

create table if not exists public.event_reminder_log (
  event_id uuid not null references public.events(id) on delete cascade,
  occurs_at timestamptz not null,
  sent_at timestamptz not null default now(),
  primary key (event_id, occurs_at)
);
alter table public.event_reminder_log enable row level security;
revoke all on public.event_reminder_log from anon, authenticated;

-- Occurrences starting within the next week whose reminder time has come, in Warsaw wall time
-- (the same rule as the app: monthly on a missing day is skipped). Timed events only.
create or replace function public.claim_due_event_reminders(p_limit integer default 100)
returns table(id uuid, space_id uuid, title text, occurs_at timestamptz, recipients uuid[])
language sql
security definer
set search_path = ''
as $function$
  with base as (
    select e.*, (e.starts_at at time zone 'Europe/Warsaw') as local_start
    from public.events e
    where e.remind_minutes is not null and not e.all_day
  ), occ as (
    select b.id, b.space_id, b.title, b.remind_minutes, b.visibility, b.person, b.created_by,
      ((d::date + b.local_start::time) at time zone 'Europe/Warsaw') as occurs_at
    from base b
    cross join lateral pg_catalog.generate_series(
      greatest(b.local_start::date, ((pg_catalog.now() at time zone 'Europe/Warsaw')::date - 1)),
      ((pg_catalog.now() at time zone 'Europe/Warsaw')::date + 8), interval '1 day') as d
    where d::date <= coalesce(b.repeat_until, 'infinity'::date)
      and case coalesce(b.recurrence, 'none')
        when 'weekly' then (d::date - b.local_start::date) % 7 = 0
        when 'monthly' then extract(day from d) = extract(day from b.local_start)
        when 'yearly' then extract(day from d) = extract(day from b.local_start) and extract(month from d) = extract(month from b.local_start)
        else d::date = b.local_start::date
      end
  ), due as (
    select * from occ
    where occurs_at - pg_catalog.make_interval(mins => remind_minutes) <= pg_catalog.now()
      and occurs_at > pg_catalog.now() - interval '30 minutes'
    order by occurs_at
    limit greatest(1, least(coalesce(p_limit, 100), 100))
  ), claimed as (
    insert into public.event_reminder_log (event_id, occurs_at)
    select due.id, due.occurs_at from due
    on conflict do nothing
    returning event_id, occurs_at
  )
  select due.id, due.space_id, due.title, due.occurs_at,
    -- Only current members of the space are ever sent a reminder.
    array(
      select sm.user_id from public.space_members sm
      where sm.space_id = due.space_id
        and (due.visibility <> 'personal' or sm.user_id = due.created_by)
        and (due.visibility = 'personal' or due.person is null or sm.user_id = due.person)
    )
  from due join claimed on claimed.event_id = due.id and claimed.occurs_at = due.occurs_at;
$function$;
revoke all on function public.claim_due_event_reminders(integer) from public, anon, authenticated;
grant execute on function public.claim_due_event_reminders(integer) to service_role;
