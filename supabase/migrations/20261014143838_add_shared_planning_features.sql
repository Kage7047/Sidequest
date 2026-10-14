alter table public.tasks
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists recurrence_rule text not null default 'none'
    check (recurrence_rule in ('none', 'daily', 'weekly', 'monthly')),
  add column if not exists reminder_at timestamptz,
  add column if not exists reminder_sent_at timestamptz;

create index if not exists tasks_assigned_to_idx on public.tasks (assigned_to);
create index if not exists tasks_reminder_due_idx on public.tasks (reminder_at) where reminder_at is not null and reminder_sent_at is null;

create table if not exists public.shared_lists (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 100),
  list_type text not null default 'custom' check (list_type in ('grocery', 'packing', 'custom')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shared_lists_space_created_idx on public.shared_lists (space_id, created_at desc);
alter table public.shared_lists enable row level security;
grant select, insert, update, delete on public.shared_lists to authenticated;
create policy "Members can view shared lists" on public.shared_lists for select to authenticated using (private.is_space_member(space_id));
create policy "Members can create shared lists" on public.shared_lists for insert to authenticated with check (private.is_space_member(space_id) and created_by = (select auth.uid()));
create policy "Members can update shared lists" on public.shared_lists for update to authenticated using (private.is_space_member(space_id)) with check (private.is_space_member(space_id));
create policy "Members can delete shared lists" on public.shared_lists for delete to authenticated using (private.is_space_member(space_id));

create table if not exists public.shared_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.shared_lists(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  completed boolean not null default false,
  created_by uuid not null references auth.users(id),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shared_list_items_list_position_idx on public.shared_list_items (list_id, completed, position, created_at);
alter table public.shared_list_items enable row level security;
grant select, insert, update, delete on public.shared_list_items to authenticated;
create policy "Members can view shared list items" on public.shared_list_items for select to authenticated
  using (exists (select 1 from public.shared_lists l where l.id = list_id and private.is_space_member(l.space_id)));
create policy "Members can add shared list items" on public.shared_list_items for insert to authenticated
  with check (created_by = (select auth.uid()) and exists (select 1 from public.shared_lists l where l.id = list_id and private.is_space_member(l.space_id)));
create policy "Members can update shared list items" on public.shared_list_items for update to authenticated
  using (exists (select 1 from public.shared_lists l where l.id = list_id and private.is_space_member(l.space_id)))
  with check (exists (select 1 from public.shared_lists l where l.id = list_id and private.is_space_member(l.space_id)));
create policy "Members can delete shared list items" on public.shared_list_items for delete to authenticated
  using (exists (select 1 from public.shared_lists l where l.id = list_id and private.is_space_member(l.space_id)));

create table if not exists public.shared_ideas (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  kind text not null default 'activity' check (kind in ('date', 'place', 'activity')),
  title text not null check (char_length(trim(title)) between 1 and 200),
  details text,
  completed boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shared_ideas_space_created_idx on public.shared_ideas (space_id, completed, created_at desc);
alter table public.shared_ideas enable row level security;
grant select, insert, update, delete on public.shared_ideas to authenticated;
create policy "Members can view shared ideas" on public.shared_ideas for select to authenticated using (private.is_space_member(space_id));
create policy "Members can add shared ideas" on public.shared_ideas for insert to authenticated with check (private.is_space_member(space_id) and created_by = (select auth.uid()));
create policy "Members can update shared ideas" on public.shared_ideas for update to authenticated using (private.is_space_member(space_id)) with check (private.is_space_member(space_id));
create policy "Members can delete shared ideas" on public.shared_ideas for delete to authenticated using (private.is_space_member(space_id));

