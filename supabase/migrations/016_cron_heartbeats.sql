-- Liveness heartbeat for unattended cron jobs.
--
-- Records the last time a named cron executed successfully — distinct from
-- whether its work was *healthy*. The capture watchdog reads 'snapshot-run' to
-- detect a silently-stopped reconcile (timer disabled, path throwing) that the
-- run-time capture-health alerting cannot see, because that alerting only fires
-- when a run actually executes.
--
-- Written via the service-role admin client (bypasses RLS), so no insert/update
-- policy — same shape as schedule_rows. Readable by any authenticated user.
create table cron_heartbeats (
  name text primary key,
  last_success_at timestamptz not null default now()
);

alter table cron_heartbeats enable row level security;

create policy "Authenticated can read cron_heartbeats"
  on cron_heartbeats for select
  using (auth.uid() is not null);

-- Seed so the watchdog has a grace window before the first reconcile runs.
insert into cron_heartbeats (name, last_success_at)
  values ('snapshot-run', now())
  on conflict (name) do nothing;
