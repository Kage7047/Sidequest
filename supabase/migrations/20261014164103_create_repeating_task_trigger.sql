create or replace function public.create_next_repeating_task()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_due timestamptz;
begin
  if old.completed is false and new.completed is true and new.recurrence_rule <> 'none' then
    next_due := coalesce(new.due_at, now()) +
      case new.recurrence_rule
        when 'daily' then interval '1 day'
        when 'weekly' then interval '1 week'
        when 'monthly' then interval '1 month'
      end;

    insert into public.tasks (
      space_id, project_id, title, description, due_at, priority,
      assigned_to, recurrence_rule, created_by
    ) values (
      new.space_id, new.project_id, new.title, new.description, next_due,
      new.priority, new.assigned_to, new.recurrence_rule, (select auth.uid())
    );
  end if;
  return new;
end;
$$;

revoke all on function public.create_next_repeating_task() from public, anon;
grant execute on function public.create_next_repeating_task() to authenticated;

drop trigger if exists create_next_repeating_task on public.tasks;
create trigger create_next_repeating_task
after update of completed on public.tasks
for each row
when (old.completed is distinct from new.completed and new.completed = true and new.recurrence_rule <> 'none')
execute function public.create_next_repeating_task();
