alter table public.tasks
  add column if not exists rotate_assignee boolean not null default false;

create or replace function public.create_next_repeating_task()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_due timestamptz;
  next_assignee uuid;
begin
  if old.completed is false and new.completed is true and new.recurrence_rule <> 'none' then
    next_due := coalesce(new.due_at, now()) +
      case new.recurrence_rule
        when 'daily' then interval '1 day'
        when 'weekly' then interval '1 week'
        when 'monthly' then interval '1 month'
      end;

    next_assignee := new.assigned_to;
    if new.rotate_assignee and new.assigned_to is not null then
      select sm.user_id into next_assignee
      from public.space_members sm
      where sm.space_id = new.space_id
        and sm.user_id <> new.assigned_to
      order by sm.joined_at
      limit 1;
      next_assignee := coalesce(next_assignee, new.assigned_to);
    end if;

    insert into public.tasks (
      space_id, project_id, title, description, due_at, priority,
      assigned_to, recurrence_rule, rotate_assignee, created_by
    ) values (
      new.space_id, new.project_id, new.title, new.description, next_due,
      new.priority, next_assignee, new.recurrence_rule, new.rotate_assignee, (select auth.uid())
    );
  end if;
  return new;
end;
$$;

revoke all on function public.create_next_repeating_task() from public, anon;
grant execute on function public.create_next_repeating_task() to authenticated;
