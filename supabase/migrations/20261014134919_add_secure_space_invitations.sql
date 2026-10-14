create schema if not exists private;

create table private.space_invitations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  invited_email text not null,
  token_hash text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  constraint space_invitations_email_format check (invited_email = pg_catalog.lower(pg_catalog.btrim(invited_email))),
  constraint space_invitations_expiry check (expires_at > created_at)
);

alter table private.space_invitations enable row level security;
revoke all on table private.space_invitations from public, anon, authenticated;

create or replace function public.create_space_invitation(p_space_id uuid, p_invited_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_owner_id uuid;
  v_owner_email text;
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_invited_email));
  v_member_count integer;
  v_token text;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Sign in before creating an invitation.';
  end if;

  select u.email into v_owner_email
  from auth.users as u
  where u.id = v_user_id and u.email_confirmed_at is not null;
  if v_owner_email is null then
    raise exception using errcode = '28000', message = 'Confirm your email before creating an invitation.';
  end if;

  select s.owner_id into v_owner_id
  from public.spaces as s
  where s.id = p_space_id
  for update;
  if not found or v_owner_id <> v_user_id then
    raise exception using errcode = '42501', message = 'Only the owner can invite someone to this space.';
  end if;

  if v_email is null or pg_catalog.length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'Enter a valid email address.';
  end if;
  if v_email = pg_catalog.lower(v_owner_email) then
    raise exception using errcode = '22023', message = 'Use your partner’s email address.';
  end if;

  select pg_catalog.count(*) into v_member_count
  from public.space_members as sm
  where sm.space_id = p_space_id;
  if v_member_count <> 1 then
    raise exception using errcode = '23514', message = 'This space already has a partner.';
  end if;

  if exists (
    select 1
    from auth.users as u
    join public.space_members as sm on sm.user_id = u.id and sm.space_id = p_space_id
    where pg_catalog.lower(u.email) = v_email
  ) then
    raise exception using errcode = '23505', message = 'That account is already in this space.';
  end if;

  update private.space_invitations as i
  set expires_at = pg_catalog.now()
  where i.space_id = p_space_id and i.used_at is null and i.expires_at > pg_catalog.now();

  v_token := pg_catalog.replace(pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text, '-', '');
  insert into private.space_invitations (space_id, invited_email, token_hash, created_by, expires_at)
  values (
    p_space_id,
    v_email,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
    v_user_id,
    pg_catalog.now() + interval '7 days'
  );

  return v_token;
end;
$function$;

create or replace function public.accept_space_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_space_id uuid;
  v_invited_email text;
  v_member_count integer;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Sign in before accepting an invitation.';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'This invitation link is invalid or expired.';
  end if;

  select u.email into v_user_email
  from auth.users as u
  where u.id = v_user_id and u.email_confirmed_at is not null;
  if v_user_email is null then
    raise exception using errcode = '28000', message = 'Confirm your email before accepting an invitation.';
  end if;

  select i.space_id, i.invited_email into v_space_id, v_invited_email
  from private.space_invitations as i
  where i.token_hash = pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
    and i.used_at is null
    and i.expires_at > pg_catalog.now()
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'This invitation link is invalid or expired.';
  end if;
  if pg_catalog.lower(v_user_email) <> v_invited_email then
    raise exception using errcode = '42501', message = 'Sign in with the email address this invitation was sent to.';
  end if;

  if exists (select 1 from public.space_members as sm where sm.space_id = v_space_id and sm.user_id = v_user_id) then
    update private.space_invitations as i set used_at = pg_catalog.now() where i.token_hash = pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
    return v_space_id;
  end if;
  if exists (select 1 from public.space_members as sm where sm.user_id = v_user_id) then
    raise exception using errcode = '23514', message = 'This account already belongs to another space.';
  end if;

  select pg_catalog.count(*) into v_member_count
  from public.space_members as sm
  where sm.space_id = v_space_id;
  if v_member_count <> 1 then
    raise exception using errcode = '23514', message = 'This space is no longer available for invitations.';
  end if;

  insert into public.space_members (space_id, user_id, role)
  values (v_space_id, v_user_id, 'member');
  update private.space_invitations as i
  set used_at = pg_catalog.now()
  where i.token_hash = pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_token, 'UTF8'), 'sha256'), 'hex');

  return v_space_id;
end;
$function$;

revoke all on function public.create_space_invitation(uuid, text) from public, anon, authenticated;
revoke all on function public.accept_space_invitation(text) from public, anon, authenticated;
grant execute on function public.create_space_invitation(uuid, text) to authenticated;
grant execute on function public.accept_space_invitation(text) to authenticated;
