-- Travel legs: Teak pick-up/drop-off details per date
create table travel_legs (
  id uuid primary key default gen_random_uuid(),
  date date unique not null,
  action text not null check (action in ('Pick up', 'Drop off')),
  location text not null default '',
  time text not null default '',
  companion text not null default '',
  companion_pre_position_flight text not null default '',
  teak_flight text not null default '',
  companion_return_flight text not null default '',
  created_by uuid not null references profiles(id),
  updated_at timestamptz not null default now()
);

create index idx_travel_legs_date on travel_legs(date);

-- RLS
alter table travel_legs enable row level security;

create policy "Authenticated users can read travel legs"
  on travel_legs for select
  using (auth.uid() is not null);

create policy "Management can insert travel legs"
  on travel_legs for insert
  with check (is_management());

create policy "Management can update travel legs"
  on travel_legs for update
  using (is_management());

create policy "Management can delete travel legs"
  on travel_legs for delete
  using (is_management());
