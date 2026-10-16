-- Both members can edit shared events; a private event stays editable only by its creator.
drop policy if exists "Owners can update shared events or their own personal events" on public.events;
drop policy if exists "Members can update shared events or their own personal events" on public.events;
create policy "Members can update shared events or their own personal events"
  on public.events for update to authenticated
  using (
    private.is_space_member(space_id)
    and (visibility = 'shared' or created_by = (select auth.uid()))
  )
  with check (
    private.is_space_member(space_id)
    and (visibility = 'shared' or created_by = (select auth.uid()))
  );
