-- Per-user AI usage, for rate limits that a user cannot reset. Users may read their own rows; only the
-- server writes them (with the secret key, which bypasses RLS). Not synced to devices, not in realtime.
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('chat', 'plan')),
  created_at timestamptz not null default now(),
  input_tokens integer,
  output_tokens integer
);
create index if not exists ai_usage_user_kind_time on public.ai_usage (user_id, kind, created_at desc);

alter table public.ai_usage enable row level security;
drop policy if exists ai_usage_owner_read on public.ai_usage;
create policy ai_usage_owner_read on public.ai_usage for select to authenticated using (user_id = (select auth.uid()));
-- deliberately no insert / update / delete policy for authenticated users
