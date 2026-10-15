-- Handle goals created at 100% without reading OLD values on an INSERT trigger.
create or replace function private.log_completion_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_just_completed boolean := false;
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
    if tg_op = 'INSERT' then
      v_just_completed := new.progress = 100;
    elsif tg_op = 'UPDATE' then
      v_just_completed := old.progress < 100 and new.progress = 100;
    end if;
    if v_just_completed then
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
