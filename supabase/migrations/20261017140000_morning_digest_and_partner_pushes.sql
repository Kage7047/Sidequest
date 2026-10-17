-- 1) One morning push each (07:00–07:59 Warsaw): today's events, tasks and both people's shifts.
-- 2) A push when your partner assigns you a task or adds a shared event for you.
create table if not exists public.digest_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.digest_log enable row level security;
revoke all on public.digest_log from anon, authenticated;

create table if not exists public.partner_notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  url text not null,
  created_at timestamptz not null default now()
);
alter table public.partner_notifications enable row level security;
revoke all on public.partner_notifications from anon, authenticated;

-- Runs as the table owner so the trigger can queue a row the users themselves can't read.
create or replace function private.queue_partner_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_name text;
begin
  if actor is null then return new; end if;
  select coalesce(nullif(pg_catalog.btrim(sm.display_name), ''), 'Your partner') into actor_name
  from public.space_members sm where sm.space_id = new.space_id and sm.user_id = actor;
  if tg_table_name = 'tasks' then
    if new.assigned_to is not null and new.assigned_to <> actor and not new.completed
       and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
      insert into public.partner_notifications (user_id, title, body, url)
      values (new.assigned_to, actor_name || ' gave you a task', new.title, '/Sidequest/?view=tasks');
    end if;
  elsif tg_table_name = 'events' then
    if tg_op = 'INSERT' and new.visibility = 'shared' then
      insert into public.partner_notifications (user_id, title, body, url)
      select sm.user_id, actor_name || ' added an event',
        new.title || ' · ' || pg_catalog.to_char(new.starts_at at time zone 'Europe/Warsaw', case when new.all_day then 'Dy DD Mon' else 'Dy DD Mon HH24:MI' end),
        '/Sidequest/?view=calendar'
      from public.space_members sm
      where sm.space_id = new.space_id and sm.user_id <> actor
        and (new.person is null or new.person = sm.user_id);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.queue_partner_notification() from public, anon, authenticated;

drop trigger if exists queue_partner_notification on public.tasks;
create trigger queue_partner_notification after insert or update of assigned_to on public.tasks
for each row execute function private.queue_partner_notification();
drop trigger if exists queue_partner_notification on public.events;
create trigger queue_partner_notification after insert on public.events
for each row execute function private.queue_partner_notification();

create or replace function public.claim_partner_notifications(p_limit integer default 100)
returns table(user_id uuid, title text, body text, url text)
language sql
security definer
set search_path = ''
as $function$
  delete from public.partner_notifications n
  where n.id in (select id from public.partner_notifications order by id limit greatest(1, least(coalesce(p_limit, 100), 100)) for update skip locked)
  returning n.user_id, n.title, n.body, n.url;
$function$;
revoke all on function public.claim_partner_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_partner_notifications(integer) to service_role;

create or replace function public.claim_morning_digests()
returns table(user_id uuid, body text)
language sql
security definer
set search_path = ''
as $function$
  with clock as (
    select (pg_catalog.now() at time zone 'Europe/Warsaw') as t, (pg_catalog.now() at time zone 'Europe/Warsaw')::date as today
  ), people as (
    select distinct sm.space_id, sm.user_id
    from public.space_members sm
    join public.push_subscriptions ps on ps.user_id = sm.user_id
    cross join clock
    where clock.t::time >= '07:00' and clock.t::time < '08:00'
  ), todays_events as (
    select p.user_id, e.all_day, (e.starts_at at time zone 'Europe/Warsaw')::time as at
    from people p
    join public.events e on e.space_id = p.space_id
    cross join clock
    where ((e.visibility = 'shared' and (e.person is null or e.person = p.user_id)) or (e.visibility = 'personal' and e.created_by = p.user_id))
      and (e.starts_at at time zone 'Europe/Warsaw')::date <= clock.today
      and clock.today <= coalesce(e.repeat_until, 'infinity'::date)
      and case coalesce(e.recurrence, 'none')
        when 'weekly' then (clock.today - (e.starts_at at time zone 'Europe/Warsaw')::date) % 7 = 0
        when 'monthly' then extract(day from clock.today) = extract(day from e.starts_at at time zone 'Europe/Warsaw')
        when 'yearly' then pg_catalog.to_char(clock.today, 'MM-DD') = pg_catalog.to_char(e.starts_at at time zone 'Europe/Warsaw', 'MM-DD')
        else (e.starts_at at time zone 'Europe/Warsaw')::date = clock.today
          or (e.ends_at is not null and (e.ends_at at time zone 'Europe/Warsaw')::date >= clock.today)
      end
  ), summary as (
    select p.user_id,
      (select count(*) from todays_events te where te.user_id = p.user_id) as events,
      (select pg_catalog.to_char(min(te.at), 'HH24:MI') from todays_events te where te.user_id = p.user_id and not te.all_day) as first_at,
      (select count(*) from public.tasks t cross join clock
        where t.space_id = p.space_id and not t.completed and t.due_at is not null
          and (t.due_at at time zone 'Europe/Warsaw')::date <= clock.today
          and (t.assigned_to is null or t.assigned_to = p.user_id)) as tasks,
      (select pg_catalog.string_agg(
          case when s.person = p.user_id then 'You work ' else coalesce(nullif(pg_catalog.btrim(sm.display_name), ''), 'Partner') || ' works ' end
          || pg_catalog.to_char(s.starts_at at time zone 'Europe/Warsaw', 'HH24:MI') || '–' || pg_catalog.to_char(s.ends_at at time zone 'Europe/Warsaw', 'HH24:MI'),
          ' · ' order by s.person = p.user_id desc, s.starts_at)
        from public.shifts s
        join public.space_members sm on sm.space_id = s.space_id and sm.user_id = s.person
        cross join clock
        where s.space_id = p.space_id and (s.starts_at at time zone 'Europe/Warsaw')::date = clock.today) as shifts
    from people p
  ), wanted as (
    select s.user_id,
      pg_catalog.concat_ws(' · ',
        case when s.events > 0 then s.events || case when s.events = 1 then ' event' else ' events' end || coalesce(' (first ' || s.first_at || ')', '') end,
        case when s.tasks > 0 then s.tasks || case when s.tasks = 1 then ' task due' else ' tasks due' end end,
        s.shifts) as body
    from summary s
  ), claimed as (
    insert into public.digest_log (user_id, day)
    select w.user_id, clock.today from wanted w cross join clock where w.body <> ''
    on conflict do nothing
    returning user_id
  )
  select w.user_id, w.body from wanted w join claimed c on c.user_id = w.user_id;
$function$;
revoke all on function public.claim_morning_digests() from public, anon, authenticated;
grant execute on function public.claim_morning_digests() to service_role;
