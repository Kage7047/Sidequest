alter function public.create_space_invitation(uuid, text) set schema private;
alter function private.create_space_invitation(uuid, text) rename to create_space_invitation_internal;

alter function public.accept_space_invitation(text) set schema private;
alter function private.accept_space_invitation(text) rename to accept_space_invitation_internal;

grant usage on schema private to authenticated;
revoke all on function private.create_space_invitation_internal(uuid, text) from public, anon, authenticated;
revoke all on function private.accept_space_invitation_internal(text) from public, anon, authenticated;
grant execute on function private.create_space_invitation_internal(uuid, text) to authenticated;
grant execute on function private.accept_space_invitation_internal(text) to authenticated;

create policy invitation_rows_are_never_directly_accessible
on private.space_invitations
for all
to public
using (false)
with check (false);

create or replace function public.create_space_invitation(p_space_id uuid, p_invited_email text)
returns text
language sql
security invoker
set search_path = ''
as $function$
  select private.create_space_invitation_internal(p_space_id, p_invited_email);
$function$;

create or replace function public.accept_space_invitation(p_token text)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.accept_space_invitation_internal(p_token);
$function$;

revoke all on function public.create_space_invitation(uuid, text) from public, anon, authenticated;
revoke all on function public.accept_space_invitation(text) from public, anon, authenticated;
grant execute on function public.create_space_invitation(uuid, text) to authenticated;
grant execute on function public.accept_space_invitation(text) to authenticated;
