-- diet-routine initial schema
-- Single user, but every table is owned by auth.uid() with RLS.
-- Sync model: clients write rows with their own updated_at; a trigger drops writes older than the stored row
-- (last write wins across phone and web, including offline replays). Deletes are soft (deleted_at).

-- ---------- shared helpers ----------
create or replace function public.lww_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.updated_at is null then
    new.updated_at := now();
  end if;
  if tg_op = 'UPDATE' and old.updated_at is not null and new.updated_at < old.updated_at then
    return null; -- stale write from another device: keep the newer row
  end if;
  return new;
end;
$$;

-- ---------- profile ----------
create table public.profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  display_name text,
  height_cm numeric(5,1) not null default 171,
  start_weight numeric(5,1) not null default 76,
  goal_weight numeric(5,1) not null default 70,
  start_date date not null default date '2026-11-15',
  base_kcal integer not null default 1390,
  protein_floor integer not null default 110,
  timezone text not null default 'Asia/Seoul',
  preferences jsonb not null default '{}'::jsonb,        -- likes, dislikes, allergies, notes for the coach
  notification_prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------- one row per calendar day ----------
create table public.days (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  scenario text check (scenario in ('home','late','out','eatout','lateHome','rest')),
  eatout_slot text check (eatout_slot in ('lunch','dinner')),
  wake_min smallint check (wake_min between 0 and 1439),
  water_cups smallint not null default 0 check (water_cups between 0 and 20),
  steps integer not null default 0 check (steps between 0 and 200000),
  steps_source text not null default 'manual' check (steps_source in ('manual','health')),
  kcal_target integer,                                    -- override from adjustments; null = profile base
  note text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, date)
);

-- ---------- personal food library (plan foods, label photos, AI estimates) ----------
create table public.foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  brand text,
  serving_desc text not null,                             -- what the nutrients refer to, e.g. '1봉 (40g)'
  serving_g numeric(7,1),
  kcal numeric(7,1) not null,
  protein_g numeric(6,1) not null default 0,
  carbs_g numeric(6,1),
  fat_g numeric(6,1),
  sugar_g numeric(6,1),
  sodium_mg numeric(7,1),
  fiber_g numeric(6,1),
  source text not null check (source in ('plan','label_photo','ai_estimate','manual','preset')),
  image_path text,
  barcode text,
  label_lang text,                                        -- original label language for imported products
  note text,
  use_count integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index foods_user_name on public.foods (user_id, lower(name));

-- ---------- what was actually eaten ----------
create table public.meal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  slot text not null check (slot in ('breakfast','lunch','snack','post','dinner','extra')),
  kind text not null check (kind in ('plan','replace','extra','skip')),        -- skip = meal intentionally not eaten (0 kcal)
  eaten_at timestamptz,
  food_id uuid references public.foods(id) on delete set null,
  name text not null,
  servings numeric(6,2),
  amount_text text,
  items jsonb,                                            -- [{name, amount}] for planned meals
  kcal numeric(7,1) not null,
  protein_g numeric(6,1) not null default 0,
  carbs_g numeric(6,1),
  fat_g numeric(6,1),
  sugar_g numeric(6,1),
  sodium_mg numeric(7,1),
  fiber_g numeric(6,1),
  source text not null check (source in ('plan','preset','ai_text','ai_photo','label','manual')),
  photo_path text,
  confidence numeric(3,2) check (confidence between 0 and 1),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index meal_entries_user_date on public.meal_entries (user_id, date);

-- ---------- body weight, one per day ----------
create table public.weights (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  kg numeric(5,1) not null check (kg > 30 and kg < 200),
  source text not null default 'manual' check (source in ('manual','health')),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, date)
);

-- ---------- GPS runs and walks (phase 3) ----------
create table public.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null default 'run' check (kind in ('run','walk')),
  started_at timestamptz not null,
  ended_at timestamptz,
  distance_m numeric(9,1) not null default 0,
  moving_s integer not null default 0,
  elapsed_s integer not null default 0,
  avg_pace_s_per_km integer,
  kcal numeric(7,1),
  elev_gain_m numeric(6,1),
  avg_cadence smallint,
  splits jsonb,                                           -- [{km, s, pace, elev}]
  polyline text,                                          -- encoded, filtered route
  bbox jsonb,
  new_distance_m numeric(9,1),                            -- streets not run before
  closed_area_m2 numeric(12,1),                           -- area of a closed loop, if any
  health_uuid text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index runs_user_started on public.runs (user_id, started_at desc);

-- ---------- workouts (home A/B, walks, runs) ----------
create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  type text not null check (type in ('home_a','home_b','walk','run','other')),
  started_at timestamptz,
  ended_at timestamptz,
  duration_s integer,
  rounds smallint,
  kcal numeric(7,1),
  source text not null default 'app' check (source in ('app','health')),
  run_id uuid references public.runs(id) on delete set null,
  note text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index workouts_user_date on public.workouts (user_id, date);

-- ---------- the meal plan itself as data (AI coach can restructure it) ----------
-- A new row takes effect from effective_from; day-only changes go to plan_adjustments instead.
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  effective_from date not null,
  slots jsonb not null,                                   -- [{key, name, icon, timing, items:[{name, amount, kcal, protein_g}], kcal, protein_g}]
  scenarios jsonb,                                        -- per-situation overrides, same shape
  source text not null default 'default' check (source in ('default','ai','user')),
  note text,                                              -- why it changed ("간식 빼고 저녁에 닭가슴살 추가")
  chat_message_id uuid,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index plans_user_from on public.plans (user_id, effective_from desc);

-- ---------- planned events ("dinner out tomorrow") ----------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  slot text check (slot in ('breakfast','lunch','snack','post','dinner','extra')),
  kind text not null check (kind in ('dinner_out','drinks','travel','other')),
  note text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index events_user_date on public.events (user_id, date);

-- ---------- applied plan changes (rebalancing, AI coach) ----------
create table public.plan_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  slot text check (slot in ('breakfast','lunch','snack','post','dinner','extra')),
  change jsonb not null,                                  -- {kcal_delta, swaps:[...], steps_delta, workout:...}
  reason text,
  source text not null check (source in ('rebalance','ai','user')),
  chat_message_id uuid,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index plan_adjustments_user_date on public.plan_adjustments (user_id, date);

-- ---------- shop list and cycle orders ----------
create table public.checklist (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  list text not null check (list in ('shop','cycle')),
  item_key text not null,
  checked boolean not null default true,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, list, item_key)
);

-- ---------- long-term personal facts the coach learns ----------
create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category text not null check (category in ('preference','habit','health','food','other')),
  content text not null,
  source text not null default 'ai' check (source in ('ai','user')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------- AI coach chat ----------
create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content jsonb not null,                                 -- text, image paths, tool calls and results, change cards
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index chat_messages_thread on public.chat_messages (thread_id, created_at);

-- ---------- RLS, sync guard, incremental pull index, realtime ----------
do $$
declare t text;
begin
  foreach t in array array['profiles','days','foods','meal_entries','weights','runs','workouts','plans','events','plan_adjustments','checklist','memories','chat_threads','chat_messages']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_owner', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.lww_guard()', t || '_lww', t);
    execute format('create index %I on public.%I (user_id, updated_at)', t || '_user_updated', t);
    execute format('alter publication supabase_realtime add table public.%I', t);
  end loop;
end $$;

-- ---------- private photo storage: photos/<uid>/... ----------
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
on conflict (id) do nothing;

create policy photos_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy photos_owner_write on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy photos_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
