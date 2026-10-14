-- Only users with a valid email-bound Sidequest invitation may create an account.
create or replace function public.before_user_created_require_invite(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(event->'user'->>'email'));
  v_token text := event->'user'->'user_metadata'->>'sidequest_invite_token';
begin
  if v_email is not null
    and v_token ~ '^[0-9a-f]{64}$'
    and exists (
      select 1
      from private.space_invitations as i
      join public.spaces as s on s.id = i.space_id
      where i.invited_email = v_email
        and i.token_hash = pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_token, 'UTF8'), 'sha256'), 'hex')
        and i.used_at is null
        and i.expires_at > pg_catalog.now()
        and (select pg_catalog.count(*) from public.space_members as sm where sm.space_id = i.space_id) = 1
    ) then
    return '{}'::jsonb;
  end if;
  return pg_catalog.jsonb_build_object('error', pg_catalog.jsonb_build_object('http_code', 403, 'message', 'A valid Sidequest invitation is required to create an account.'));
end;
$function$;
revoke all on function public.before_user_created_require_invite(jsonb) from public, anon, authenticated;
grant execute on function public.before_user_created_require_invite(jsonb) to supabase_auth_admin;

-- Device subscriptions can only be managed by the signed-in user who owns them.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from public, anon;
grant select, insert, update, delete on table public.push_subscriptions to authenticated;
drop policy if exists "Users manage own push subscriptions" on public.push_subscriptions;
create policy "Users manage own push subscriptions" on public.push_subscriptions
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);

create table if not exists public.push_config (
  id boolean primary key default true check (id),
  vapid_public_key text not null,
  vapid_private_key text not null,
  vapid_subject text not null,
  cron_secret text not null
);
alter table public.push_config enable row level security;
revoke all on table public.push_config from public, anon, authenticated;
grant all on table public.push_config to service_role;

alter table public.tasks add column if not exists reminder_claimed_at timestamptz;
create index if not exists tasks_background_reminder_idx
  on public.tasks (reminder_at) where reminder_at is not null and reminder_sent_at is null;

create or replace function public.claim_due_reminders(p_limit integer default 100)
returns table(id uuid, space_id uuid, title text, assigned_to uuid)
language sql
security definer
set search_path = ''
as $function$
  with candidates as (
    select t.id
    from public.tasks as t
    where not t.completed
      and t.reminder_at <= pg_catalog.now()
      and t.reminder_sent_at is null
      and (t.reminder_claimed_at is null or t.reminder_claimed_at < pg_catalog.now() - interval '10 minutes')
    order by t.reminder_at asc
    limit greatest(1, least(coalesce(p_limit, 100), 100))
    for update of t skip locked
  ), claimed as (
    update public.tasks as t
    set reminder_claimed_at = pg_catalog.now()
    from candidates as c
    where t.id = c.id
    returning t.id, t.space_id, t.title, t.assigned_to
  )
  select claimed.id, claimed.space_id, claimed.title, claimed.assigned_to from claimed;
$function$;
revoke all on function public.claim_due_reminders(integer) from public, anon, authenticated;
grant execute on function public.claim_due_reminders(integer) to service_role;
