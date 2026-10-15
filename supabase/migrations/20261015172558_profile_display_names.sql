-- Give the existing members their familiar names and allow each person to edit only their own display name.
update public.space_members as member
set display_name = case when member.user_id = space.owner_id then 'Ilya' else 'Angie' end
from public.spaces as space
where space.id = member.space_id
  and nullif(pg_catalog.btrim(member.display_name), '') is null;

revoke update on table public.space_members from public, anon, authenticated;
grant update (display_name) on table public.space_members to authenticated;

drop policy if exists "Members can update their own display name" on public.space_members;
create policy "Members can update their own display name"
on public.space_members
for update
to authenticated
using (
  (select auth.uid()) = user_id
  and (select private.is_space_member(space_id))
)
with check (
  (select auth.uid()) = user_id
  and (select private.is_space_member(space_id))
);
