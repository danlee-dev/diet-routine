-- Multi-user: profiles carry onboarding answers and body stats; plan versions carry a personal shopping list
-- and rule cards. Additive only; the owner's existing rows keep working with the built-in plan as fallback.
alter table public.profiles add column if not exists days integer not null default 30;
alter table public.profiles add column if not exists sex text check (sex in ('male','female'));
alter table public.profiles add column if not exists birth_year integer;
alter table public.profiles add column if not exists activity text check (activity in ('sedentary','light','active'));
alter table public.profiles add column if not exists onboarding jsonb;
alter table public.profiles add column if not exists onboarded_at timestamptz;

alter table public.plans add column if not exists shop jsonb;   -- {now:[ShopItem], week:[ShopItem], cycle:[CycleItem]}
alter table public.plans add column if not exists rules jsonb;  -- [{icon, title, desc}]
