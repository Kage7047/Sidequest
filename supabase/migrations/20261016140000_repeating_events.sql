-- Repeating events: weekly, monthly or yearly, optionally until a date.
alter table public.events
  add column if not exists recurrence text not null default 'none'
    check (recurrence in ('none', 'weekly', 'monthly', 'yearly')),
  add column if not exists repeat_until date;

-- partner_busy also returns the repeat rule, and keeps old repeating events that are still active.
drop function if exists public.partner_busy(uuid);
create function public.partner_busy(p_space_id uuid)
returns table (id uuid, starts_at timestamptz, ends_at timestamptz, all_day boolean, created_by uuid, recurrence text, repeat_until date)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.starts_at, e.ends_at, e.all_day, e.created_by, e.recurrence, e.repeat_until
  from public.events e
  where e.space_id = p_space_id
    and private.is_space_member(p_space_id)
    and e.visibility = 'personal'
    and e.created_by <> (select auth.uid())
    and (
      coalesce(e.ends_at, e.starts_at) >= pg_catalog.now() - interval '120 days'
      or (e.recurrence <> 'none' and (e.repeat_until is null or e.repeat_until >= (pg_catalog.now() - interval '120 days')::date))
    );
$$;

revoke all on function public.partner_busy(uuid) from public, anon;
grant execute on function public.partner_busy(uuid) to authenticated;
