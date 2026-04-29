-- Frozen point-in-time snapshots of past dashboard cards.
-- Cron writes here (frozen_by='cron'); lazy backfill in the dashboard
-- writes here too (frozen_by='lazy'). 'manual' is reserved for a future
-- admin re-snapshot action and is allowed by the check constraint so we
-- don't need a migration when we add it.
create table card_snapshots (
  date date primary key,
  payload jsonb not null,
  frozen_at timestamptz not null default now(),
  frozen_by text not null check (frozen_by in ('cron', 'lazy', 'manual'))
);

create index idx_card_snapshots_date on card_snapshots(date);

alter table card_snapshots enable row level security;

create policy "Authenticated can read snapshots"
  on card_snapshots for select
  using (auth.uid() is not null);

create policy "Management can insert snapshots"
  on card_snapshots for insert
  with check (is_management());

create policy "Management can update snapshots"
  on card_snapshots for update
  using (is_management());
