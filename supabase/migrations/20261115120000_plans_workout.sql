-- Workout plan edits (weekly schedule and routine exercises) live next to meal edits in each plan version.
alter table public.plans add column if not exists workout jsonb;
comment on column public.plans.workout is '{week: {"0".."6": "A"|"B"|"walk"|"light"|"rest"}, routines: {A|B: {items: [{name, n, unit}]}}}';
