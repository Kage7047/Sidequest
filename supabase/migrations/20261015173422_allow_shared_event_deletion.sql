-- Both members can remove shared events; a personal event stays under its creator's control.
drop policy if exists "Owners can delete shared events or their own personal events" on public.events;
create policy "Members can delete shared events or their own personal events"
  on public.events for delete to authenticated
  using (
    private.is_space_member(space_id)
    and (visibility = 'shared' or created_by = (select auth.uid()))
  );
