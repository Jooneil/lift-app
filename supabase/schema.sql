-- Supabase schema and indexes for RLS-backed Lift App

-- plans
create table if not exists public.plans (
  id bigserial primary key,
  user_id uuid not null default auth.uid(),
  name text not null,
  data jsonb,
  archived int default 0,
  predecessor_plan_id bigint,
  created_at timestamptz default now()
);
alter table public.plans enable row level security;
create policy if not exists plans_isolation on public.plans for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists idx_plans_user_created on public.plans(user_id, created_at desc);
-- optional unique plan names per user
-- alter table public.plans add constraint uniq_user_planname unique (user_id, name);

-- sessions
create table if not exists public.sessions (
  user_id uuid not null default auth.uid(),
  plan_id bigint not null,
  week_id text not null,
  day_id text not null,
  data jsonb,
  updated_at timestamptz default now(),
  constraint sessions_pk primary key (user_id, plan_id, week_id, day_id)
);
alter table public.sessions enable row level security;
create policy if not exists sessions_isolation on public.sessions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- completions
create table if not exists public.completions (
  user_id uuid not null default auth.uid(),
  plan_id bigint not null,
  week_id text not null,
  day_id text not null,
  completed_at timestamptz default now(),
  constraint completions_pk primary key (user_id, plan_id, week_id, day_id)
);
alter table public.completions enable row level security;
create policy if not exists completions_isolation on public.completions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- user_prefs
create table if not exists public.user_prefs (
  user_id uuid primary key default auth.uid(),
  last_plan_server_id bigint,
  last_week_id text,
  last_day_id text,
  prefs jsonb
);
alter table public.user_prefs enable row level security;
create policy if not exists user_prefs_isolation on public.user_prefs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- templates
create table if not exists public.templates (
  id bigserial primary key,
  user_id uuid not null default auth.uid(),
  name text not null,
  data jsonb,
  created_at timestamptz default now()
);
alter table public.templates enable row level security;
create policy if not exists templates_isolation on public.templates for all using (user_id = auth.uid()) with check (user_id = auth.uid());

