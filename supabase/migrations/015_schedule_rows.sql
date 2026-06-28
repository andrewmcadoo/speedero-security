-- Durable mirror of Google Sheet schedule rows.
--
-- Schedule *content* (activity, flight, location, …) otherwise lives only in
-- the Google Sheet. If a row is deleted from the sheet before its card is ever
-- frozen into card_snapshots, the day's data is lost (renders as a "?" card).
--
-- This table is upserted on every sheet read (dashboard load, cron, webhook
-- invalidation) keyed by date, and rows are NEVER deleted when they vanish from
-- the sheet. The freeze/backfill path falls back to this mirror when the live
-- sheet row is gone, so a row deleted at any time still survives as a snapshot.
--
-- Writes go through the service-role admin client (bypasses RLS), so no
-- insert/update policy is defined here. Reads are open to any authenticated
-- user, matching card_snapshots.
create table schedule_rows (
  date date primary key,
  row_id text,
  payload jsonb not null,            -- the full ScheduleEntry as last seen
  last_seen_at timestamptz not null default now()
);

create index idx_schedule_rows_date on schedule_rows(date);

alter table schedule_rows enable row level security;

create policy "Authenticated can read schedule_rows"
  on schedule_rows for select
  using (auth.uid() is not null);
