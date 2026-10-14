create or replace function public.ensure_task_assignee_is_member()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.assigned_to is not null and not exists (
    select 1 from public.space_members sm
    where sm.space_id = new.space_id and sm.user_id = new.assigned_to
  ) then
    raise exception 'The assigned person must belong to this shared space.';
  end if;
  return new;
end;
$$;

revoke all on function public.ensure_task_assignee_is_member() from public, anon;
grant execute on function public.ensure_task_assignee_is_member() to authenticated;
create trigger ensure_task_assignee_is_member
before insert or update of assigned_to, space_id on public.tasks
for each row execute function public.ensure_task_assignee_is_member();
