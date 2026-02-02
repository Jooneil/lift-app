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
drop policy if exists plans_isolation on public.plans;
create policy plans_isolation on public.plans for all using (user_id = auth.uid()) with check (user_id = auth.uid());
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
alter table public.sessions add column if not exists user_id uuid;
alter table public.sessions alter column user_id set default auth.uid();
alter table public.sessions add column if not exists updated_at timestamptz;
alter table public.sessions alter column updated_at set default now();
alter table public.sessions enable row level security;
drop policy if exists sessions_isolation on public.sessions;
create policy sessions_isolation on public.sessions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- completions
create table if not exists public.completions (
  user_id uuid not null default auth.uid(),
  plan_id bigint not null,
  week_id text not null,
  day_id text not null,
  completed_at timestamptz default now(),
  constraint completions_pk primary key (user_id, plan_id, week_id, day_id)
);
alter table public.completions add column if not exists user_id uuid;
alter table public.completions alter column user_id set default auth.uid();
alter table public.completions enable row level security;
drop policy if exists completions_isolation on public.completions;
create policy completions_isolation on public.completions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- user_prefs
create table if not exists public.user_prefs (
  user_id uuid primary key default auth.uid(),
  last_plan_server_id bigint,
  last_week_id text,
  last_day_id text,
  prefs jsonb
);
alter table public.user_prefs enable row level security;
drop policy if exists user_prefs_isolation on public.user_prefs;
create policy user_prefs_isolation on public.user_prefs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- templates
create table if not exists public.templates (
  id bigserial primary key,
  user_id uuid not null default auth.uid(),
  name text not null,
  data jsonb,
  created_at timestamptz default now()
);
alter table public.templates enable row level security;
drop policy if exists templates_isolation on public.templates;
create policy templates_isolation on public.templates for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- exercises
create table if not exists public.exercises (
  id bigserial primary key,
  user_id uuid not null default auth.uid(),
  name text not null,
  created_at timestamptz default now()
);
alter table public.exercises add column if not exists primary_muscle text;
alter table public.exercises add column if not exists machine boolean default false;
alter table public.exercises add column if not exists free_weight boolean default false;
alter table public.exercises add column if not exists cable boolean default false;
alter table public.exercises add column if not exists body_weight boolean default false;
alter table public.exercises add column if not exists is_compound boolean default false;
alter table public.exercises add column if not exists secondary_muscles text[] default '{}'::text[];
alter table public.exercises add column if not exists is_custom boolean default false;
alter table public.exercises enable row level security;
drop policy if exists exercises_isolation on public.exercises;
create policy exercises_isolation on public.exercises for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create unique index if not exists idx_exercises_user_lower_name on public.exercises(user_id, lower(name));

-- exercise catalog (global, shared across users)
create table if not exists public.exercise_catalog (
  id bigserial primary key,
  name text not null,
  primary_muscle text not null,
  machine boolean default false,
  free_weight boolean default false,
  cable boolean default false,
  body_weight boolean default false,
  is_compound boolean default false,
  secondary_muscles text[] default '{}'::text[]
);
alter table public.exercise_catalog enable row level security;
drop policy if exists exercise_catalog_read on public.exercise_catalog;
create policy exercise_catalog_read on public.exercise_catalog for select using (true);
create unique index if not exists idx_exercise_catalog_lower_name on public.exercise_catalog(lower(name));
grant select on public.exercise_catalog to anon, authenticated;

with catalog_seed as (
  select *
  from (values
  ('Barbell Back Squat','Quads',false,true,false,false,true,ARRAY['Glutes']),
  ('Barbell Front Squat','Quads',false,true,false,false,true,ARRAY['Glutes']),
  ('Goblet Squat','Quads',false,true,false,false,true,ARRAY['Glutes']),
  ('Dumbbell Split Squat','Quads',false,true,false,false,true,ARRAY['Glutes']),
  ('Bulgarian Split Squat','Quads',false,true,false,false,true,ARRAY['Glutes']),
  ('Leg Press','Quads',true,false,false,false,true,ARRAY['Glutes']),
  ('Hack Squat','Quads',true,false,false,false,true,ARRAY['Glutes']),
  ('Leg Extension','Quads',true,false,false,false,false,ARRAY[]::text[]),
  ('Romanian Deadlift (Barbell)','Hamstrings',false,true,false,false,true,ARRAY['Glutes']),
  ('Romanian Deadlift (Dumbbells)','Hamstrings',false,true,false,false,true,ARRAY['Glutes']),
  ('Deadlift (Conventional)','Glutes',false,true,false,false,true,ARRAY['Hamstrings']),
  ('Deadlift (Sumo)','Glutes',false,true,false,false,true,ARRAY['Quads']),
  ('Trap Bar Deadlift','Glutes',false,true,false,false,true,ARRAY['Quads']),
  ('Good Morning','Hamstrings',false,true,false,false,true,ARRAY['Glutes']),
  ('Hip Thrust (Barbell)','Glutes',false,true,false,false,true,ARRAY['Hamstrings']),
  ('Glute Bridge','Glutes',false,false,false,true,true,ARRAY['Hamstrings']),
  ('Lying Leg Curl','Hamstrings',true,false,false,false,false,ARRAY[]::text[]),
  ('Seated Leg Curl','Hamstrings',true,false,false,false,false,ARRAY[]::text[]),
  ('Nordic Curl','Hamstrings',false,false,false,true,false,ARRAY[]::text[]),
  ('Standing Calf Raise','Calves',true,false,false,false,false,ARRAY[]::text[]),
  ('Seated Calf Raise','Calves',true,false,false,false,false,ARRAY[]::text[]),
  ('Single-Leg Calf Raise','Calves',false,false,false,true,false,ARRAY[]::text[]),
  ('Barbell Bench Press','Chest',false,true,false,false,true,ARRAY['Tricep']),
  ('Dumbbell Bench Press','Chest',false,true,false,false,true,ARRAY['Tricep']),
  ('Incline Dumbbell Press','Chest',false,true,false,false,true,ARRAY['Tricep']),
  ('Incline Barbell Bench Press','Chest',false,true,false,false,true,ARRAY['Tricep']),
  ('Push-Up','Chest',false,false,false,true,true,ARRAY['Tricep']),
  ('Dip (Chest Lean)','Chest',false,false,false,true,true,ARRAY['Tricep']),
  ('Machine Chest Press','Chest',true,false,false,false,true,ARRAY['Tricep']),
  ('Cable Fly','Chest',false,false,true,false,false,ARRAY[]::text[]),
  ('Pec Deck','Chest',true,false,false,false,false,ARRAY[]::text[]),
  ('Overhead Press (Barbell)','Front Delt',false,true,false,false,true,ARRAY['Tricep']),
  ('Overhead Press (Dumbbells)','Front Delt',false,true,false,false,true,ARRAY['Tricep']),
  ('Arnold Press','Front Delt',false,true,false,false,true,ARRAY['Side Delt']),
  ('Machine Shoulder Press','Front Delt',true,false,false,false,true,ARRAY['Tricep']),
  ('Lateral Raise','Side Delt',false,true,false,false,false,ARRAY[]::text[]),
  ('Cable Lateral Raise','Side Delt',false,false,true,false,false,ARRAY[]::text[]),
  ('Rear Delt Fly (Dumbbells)','Rear Delt',false,true,false,false,false,ARRAY[]::text[]),
  ('Rear Delt Fly (Cable)','Rear Delt',false,false,true,false,false,ARRAY[]::text[]),
  ('Face Pull','Rear Delt',false,false,true,false,true,ARRAY['Upper Back']),
  ('Pull-Up','Lats',false,false,false,true,true,ARRAY['Bicep']),
  ('Chin-Up','Lats',false,false,false,true,true,ARRAY['Bicep']),
  ('Lat Pulldown','Lats',true,false,false,false,true,ARRAY['Bicep']),
  ('Single-Arm Cable Pulldown','Lats',false,false,true,false,true,ARRAY['Bicep']),
  ('Straight-Arm Pulldown','Lats',false,false,true,false,false,ARRAY[]::text[]),
  ('Barbell Row','Upper Back',false,true,false,false,true,ARRAY['Lats']),
  ('Dumbbell Row','Upper Back',false,true,false,false,true,ARRAY['Lats']),
  ('Chest-Supported Row (Machine)','Upper Back',true,false,false,false,true,ARRAY['Lats']),
  ('Seated Cable Row','Upper Back',false,false,true,false,true,ARRAY['Lats']),
  ('T-Bar Row','Upper Back',false,true,false,false,true,ARRAY['Lats']),
  ('Inverted Row','Upper Back',false,false,false,true,true,ARRAY['Lats']),
  ('Shrug (Dumbbells)','Traps',false,true,false,false,false,ARRAY[]::text[]),
  ('Shrug (Barbell)','Traps',false,true,false,false,false,ARRAY[]::text[]),
  ('Farmer Carry','Traps',false,true,false,false,true,ARRAY['Forearm']),
  ('Biceps Curl (Barbell)','Bicep',false,true,false,false,false,ARRAY[]::text[]),
  ('Biceps Curl (Dumbbells)','Bicep',false,true,false,false,false,ARRAY[]::text[]),
  ('Hammer Curl','Bicep',false,true,false,false,false,ARRAY[]::text[]),
  ('Cable Curl','Bicep',false,false,true,false,false,ARRAY[]::text[]),
  ('Preacher Curl (Machine)','Bicep',true,false,false,false,false,ARRAY[]::text[]),
  ('Triceps Pushdown','Tricep',false,false,true,false,false,ARRAY[]::text[]),
  ('Overhead Triceps Extension (Cable)','Tricep',false,false,true,false,false,ARRAY[]::text[]),
  ('Skull Crusher','Tricep',false,true,false,false,false,ARRAY[]::text[]),
  ('Close-Grip Bench Press','Tricep',false,true,false,false,true,ARRAY['Chest']),
  ('Dip (Triceps Focus)','Tricep',false,false,false,true,true,ARRAY['Chest']),
  ('Machine Dip','Tricep',true,false,false,false,true,ARRAY['Chest']),
  ('Plank','Abs',false,false,false,true,false,ARRAY[]::text[]),
  ('Hanging Leg Raise','Abs',false,false,false,true,false,ARRAY[]::text[]),
  ('Cable Crunch','Abs',false,false,true,false,false,ARRAY[]::text[]),
  ('Ab Wheel Rollout','Abs',false,false,false,true,false,ARRAY[]::text[]),
  ('Back Extension','Lower Back',true,false,false,false,true,ARRAY['Glutes']),
  ('Hyperextension (Bodyweight)','Lower Back',false,false,false,true,true,ARRAY['Glutes']),
  ('Walking Lunge','Quads',false,true,false,false,true,ARRAY['Glutes']),
  ('Step-Up','Quads',false,true,false,false,true,ARRAY['Glutes']),
  ('Cable Pull-Through','Glutes',false,false,true,false,true,ARRAY['Hamstrings']),
  ('Smith Machine Squat','Quads',true,false,false,false,true,ARRAY['Glutes']),
  ('Smith Machine Incline Press','Chest',true,false,false,false,true,ARRAY['Tricep']),
  ('Glute Bridge','Glutes',false,false,false,true,true,ARRAY['Hamstrings','Abs']),
  ('Lying Leg Curl','Hamstrings',true,false,false,false,false,ARRAY[]::text[]),
  ('Seated Leg Curl','Hamstrings',true,false,false,false,false,ARRAY[]::text[]),
  ('Nordic Curl','Hamstrings',false,false,false,true,false,ARRAY[]::text[]),
  ('Standing Calf Raise','Calves',true,false,false,false,false,ARRAY[]::text[]),
  ('Seated Calf Raise','Calves',true,false,false,false,false,ARRAY[]::text[]),
  ('Single-Leg Calf Raise','Calves',false,false,false,true,false,ARRAY[]::text[]),
  ('Barbell Bench Press','Chest',false,true,false,false,true,ARRAY['Tricep','Front Delt']),
  ('Dumbbell Bench Press','Chest',false,true,false,false,true,ARRAY['Tricep','Front Delt']),
  ('Incline Dumbbell Press','Chest',false,true,false,false,true,ARRAY['Tricep','Front Delt']),
  ('Incline Barbell Bench Press','Chest',false,true,false,false,true,ARRAY['Tricep','Front Delt']),
  ('Push-Up','Chest',false,false,false,true,true,ARRAY['Tricep','Front Delt','Abs']),
  ('Dip (Chest Lean)','Chest',false,false,false,true,true,ARRAY['Tricep','Front Delt']),
  ('Machine Chest Press','Chest',true,false,false,false,true,ARRAY['Tricep','Front Delt']),
  ('Cable Fly','Chest',false,false,true,false,false,ARRAY[]::text[]),
  ('Pec Deck','Chest',true,false,false,false,false,ARRAY[]::text[]),
  ('Overhead Press (Barbell)','Front Delt',false,true,false,false,true,ARRAY['Tricep','Upper Back','Abs']),
  ('Overhead Press (Dumbbells)','Front Delt',false,true,false,false,true,ARRAY['Tricep','Upper Back','Abs']),
  ('Arnold Press','Front Delt',false,true,false,false,true,ARRAY['Tricep','Side Delt']),
  ('Machine Shoulder Press','Front Delt',true,false,false,false,true,ARRAY['Tricep']),
  ('Lateral Raise','Side Delt',false,true,false,false,false,ARRAY[]::text[]),
  ('Cable Lateral Raise','Side Delt',false,false,true,false,false,ARRAY[]::text[]),
  ('Rear Delt Fly (Dumbbells)','Rear Delt',false,true,false,false,false,ARRAY[]::text[]),
  ('Rear Delt Fly (Cable)','Rear Delt',false,false,true,false,false,ARRAY[]::text[]),
  ('Face Pull','Rear Delt',false,false,true,false,true,ARRAY['Upper Back','Traps']),
  ('Pull-Up','Lats',false,false,false,true,true,ARRAY['Upper Back','Bicep','Forearm']),
  ('Chin-Up','Lats',false,false,false,true,true,ARRAY['Bicep','Upper Back','Forearm']),
  ('Lat Pulldown','Lats',true,false,false,false,true,ARRAY['Bicep','Upper Back','Forearm']),
  ('Single-Arm Cable Pulldown','Lats',false,false,true,false,true,ARRAY['Bicep','Upper Back']),
  ('Straight-Arm Pulldown','Lats',false,false,true,false,false,ARRAY[]::text[]),
  ('Barbell Row','Upper Back',false,true,false,false,true,ARRAY['Lats','Bicep','Lower Back','Forearm']),
  ('Dumbbell Row','Upper Back',false,true,false,false,true,ARRAY['Lats','Bicep','Lower Back','Forearm']),
  ('Chest-Supported Row (Machine)','Upper Back',true,false,false,false,true,ARRAY['Lats','Bicep']),
  ('Seated Cable Row','Upper Back',false,false,true,false,true,ARRAY['Lats','Bicep','Rear Delt']),
  ('T-Bar Row','Upper Back',false,true,false,false,true,ARRAY['Lats','Bicep','Lower Back','Forearm']),
  ('Inverted Row','Upper Back',false,false,false,true,true,ARRAY['Lats','Bicep','Abs']),
  ('Shrug (Dumbbells)','Traps',false,true,false,false,false,ARRAY[]::text[]),
  ('Shrug (Barbell)','Traps',false,true,false,false,false,ARRAY[]::text[]),
  ('Farmer Carry','Traps',false,true,false,false,true,ARRAY['Forearm','Abs','Upper Back']),
  ('Biceps Curl (Barbell)','Bicep',false,true,false,false,false,ARRAY[]::text[]),
  ('Biceps Curl (Dumbbells)','Bicep',false,true,false,false,false,ARRAY[]::text[]),
  ('Hammer Curl','Bicep',false,true,false,false,false,ARRAY[]::text[]),
  ('Cable Curl','Bicep',false,false,true,false,false,ARRAY[]::text[]),
  ('Preacher Curl (Machine)','Bicep',true,false,false,false,false,ARRAY[]::text[]),
  ('Triceps Pushdown','Tricep',false,false,true,false,false,ARRAY[]::text[]),
  ('Overhead Triceps Extension (Cable)','Tricep',false,false,true,false,false,ARRAY[]::text[]),
  ('Skull Crusher','Tricep',false,true,false,false,false,ARRAY[]::text[]),
  ('Close-Grip Bench Press','Tricep',false,true,false,false,true,ARRAY['Chest','Front Delt']),
  ('Dip (Triceps Focus)','Tricep',false,false,false,true,true,ARRAY['Chest','Front Delt']),
  ('Machine Dip','Tricep',true,false,false,false,true,ARRAY['Chest','Front Delt']),
  ('Plank','Abs',false,false,false,true,false,ARRAY[]::text[]),
  ('Hanging Leg Raise','Abs',false,false,false,true,false,ARRAY[]::text[]),
  ('Cable Crunch','Abs',false,false,true,false,false,ARRAY[]::text[]),
  ('Ab Wheel Rollout','Abs',false,false,false,true,false,ARRAY[]::text[]),
  ('Back Extension','Lower Back',true,false,false,false,true,ARRAY['Glutes','Hamstrings']),
  ('Hyperextension (Bodyweight)','Lower Back',false,false,false,true,true,ARRAY['Glutes','Hamstrings']),
  ('Walking Lunge','Quads',false,true,false,false,true,ARRAY['Glutes','Adductors','Abs']),
  ('Step-Up','Quads',false,true,false,false,true,ARRAY['Glutes','Abs']),
  ('Cable Pull-Through','Glutes',false,false,true,false,true,ARRAY['Hamstrings','Lower Back']),
  ('Smith Machine Squat','Quads',true,false,false,false,true,ARRAY['Glutes','Adductors']),
  ('Smith Machine Incline Press','Chest',true,false,false,false,true,ARRAY['Tricep','Front Delt'])
  ) as v(name, primary_muscle, machine, free_weight, cable, body_weight, is_compound, secondary_muscles)
)
insert into public.exercise_catalog
  (name, primary_muscle, machine, free_weight, cable, body_weight, is_compound, secondary_muscles)
select distinct on (lower(name))
  name, primary_muscle, machine, free_weight, cable, body_weight, is_compound, secondary_muscles
from catalog_seed
order by lower(name), array_length(secondary_muscles, 1) desc nulls last
on conflict ((lower(name))) do update set
  primary_muscle = excluded.primary_muscle,
  machine = excluded.machine,
  free_weight = excluded.free_weight,
  cable = excluded.cable,
  body_weight = excluded.body_weight,
  is_compound = excluded.is_compound,
  secondary_muscles = excluded.secondary_muscles;
