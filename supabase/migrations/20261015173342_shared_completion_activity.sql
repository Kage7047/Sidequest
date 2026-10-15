-- Keep a small, shared history of completed tasks and goals for encouragement.
create table public.completion_activity (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  item_type text not null check (item_type in ('task', 'goal')),
  item_id uuid not null,
  title text not null,
  completed_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz not null default now(),
  unique (item_type, item_id)
);
create index completion_activity_space_date_idx on public.completion_activity (space_id, completed_at desc);
alter table public.completion_activity enable row level security;
revoke all on public.completion_activity from public, anon;
grant select on public.completion_activity to authenticated;
create policy "Space members can view completion activity"
  on public.completion_activity for select to authenticated
  using (private.is_space_member(space_id));

-- A private trigger function writes snapshots; clients can read the history but cannot forge it.
create or replace function private.log_completion_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_table_name = 'tasks' then
    if old.completed is distinct from new.completed and new.completed then
      insert into public.completion_activity (space_id, item_type, item_id, title, completed_by)
      values (new.space_id, 'task', new.id, new.title, (select auth.uid()))
      on conflict (item_type, item_id) do update
        set title = excluded.title, completed_by = excluded.completed_by, completed_at = pg_catalog.now();
    elsif old.completed is distinct from new.completed then
      delete from public.completion_activity where item_type = 'task' and item_id = old.id;
    end if;
  elsif tg_table_name = 'goals' then
    if new.progress = 100 and (tg_op = 'INSERT' or old.progress < 100) then
      insert into public.completion_activity (space_id, item_type, item_id, title, completed_by)
      values (new.space_id, 'goal', new.id, new.title, (select auth.uid()))
      on conflict (item_type, item_id) do update
        set title = excluded.title, completed_by = excluded.completed_by, completed_at = pg_catalog.now();
    elsif tg_op = 'UPDATE' and old.progress = 100 and new.progress < 100 then
      delete from public.completion_activity where item_type = 'goal' and item_id = old.id;
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function private.log_completion_activity() from public, anon, authenticated;

drop trigger if exists log_task_completion_activity on public.tasks;
create trigger log_task_completion_activity
  after update of completed on public.tasks
  for each row when (old.completed is distinct from new.completed)
  execute function private.log_completion_activity();

drop trigger if exists log_goal_completion_activity on public.goals;
create trigger log_goal_completion_activity
  after insert or update of progress on public.goals
  for each row
  execute function private.log_completion_activity();
