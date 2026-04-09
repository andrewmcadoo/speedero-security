-- Security Scheduler: Initial Schema
-- Run this in Supabase SQL Editor

-- Role enum
create type user_role as enum ('epo', 'management');

-- Profiles table (auto-populated on signup via trigger)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role user_role not null default 'epo',
  created_at timestamptz not null default now()
);

-- Assignments: maps EPOs to dates
create table assignments (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  row_id uuid,
  epo_id uuid not null references profiles(id) on delete cascade,
  assigned_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  unique (date, epo_id)
);

-- Date settings: min detail per date
create table date_settings (
  id uuid primary key default gen_random_uuid(),
  date date unique not null,
  min_detail_required integer not null default 1,
  updated_by uuid not null references profiles(id),
  updated_at timestamptz not null default now()
);

-- Indexes
create index idx_assignments_epo_id on assignments(epo_id);
create index idx_assignments_date on assignments(date);
create index idx_date_settings_date on date_settings(date);

-- Trigger: auto-create profile on new user signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, new.raw_user_meta_data->>'email', ''),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')
  );
  return new;
exception
  when others then
    raise log 'handle_new_user failed for %: %', new.id, sqlerrm;
    return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- RLS Policies
alter table profiles enable row level security;
alter table assignments enable row level security;
alter table date_settings enable row level security;

-- Helper: check if current user is management
create or replace function is_management()
returns boolean as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'management'
  );
$$ language sql security definer stable;

-- Profiles policies
create policy "Users can read own profile"
  on profiles for select
  using (id = auth.uid() or is_management());

create policy "Users can insert own profile"
  on profiles for insert
  with check (id = auth.uid());

create policy "Management can update profiles"
  on profiles for update
  using (is_management());

-- Assignments policies
create policy "EPOs can read own assignments"
  on assignments for select
  using (epo_id = auth.uid() or is_management());

create policy "Management can insert assignments"
  on assignments for insert
  with check (is_management());

create policy "Management can delete assignments"
  on assignments for delete
  using (is_management());

-- Date settings policies
create policy "Anyone authenticated can read date settings"
  on date_settings for select
  using (auth.uid() is not null);

create policy "Management can insert date settings"
  on date_settings for insert
  with check (is_management());

create policy "Management can update date settings"
  on date_settings for update
  using (is_management());
