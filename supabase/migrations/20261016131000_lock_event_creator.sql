-- Editing a shared event must not change who created it. Otherwise a member could take
-- over the other person's event and then make it private.
create or replace function public.keep_event_creator()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'The creator of an event cannot be changed.';
  end if;
  return new;
end;
$$;

revoke all on function public.keep_event_creator() from public, anon;
grant execute on function public.keep_event_creator() to authenticated;
drop trigger if exists keep_event_creator on public.events;
create trigger keep_event_creator
before update of created_by on public.events
for each row execute function public.keep_event_creator();
