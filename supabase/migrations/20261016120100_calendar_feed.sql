-- One secret calendar-feed link per person, for Google/Apple Calendar subscriptions.
-- Only the SHA-256 hash of the token is stored; the sidequest-calendar Edge Function
-- (service role) looks it up.
create table if not exists public.calendar_feeds (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now()
);
alter table public.calendar_feeds enable row level security;
revoke all on table public.calendar_feeds from public, anon, authenticated;
grant all on table public.calendar_feeds to service_role;

-- Creates a new link for the signed-in person and turns off their old one.
create or replace function public.rotate_calendar_feed()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_token text;
begin
  if v_user is null then
    raise exception 'Sign in before creating a calendar link.';
  end if;
  v_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.calendar_feeds (user_id, token_hash)
  values (v_user, pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_token, 'UTF8'), 'sha256'), 'hex'))
  on conflict (user_id) do update set token_hash = excluded.token_hash, created_at = pg_catalog.now();
  return v_token;
end;
$$;

revoke all on function public.rotate_calendar_feed() from public, anon;
grant execute on function public.rotate_calendar_feed() to authenticated;
