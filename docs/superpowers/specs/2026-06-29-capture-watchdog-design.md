# Capture Watchdog (Dead-Man's Switch) — Design

**Date:** 2026-06-29
**Status:** Approved (design); pending implementation plan
**Author:** AJ + Claude

## Context

SecApp freezes each past day's schedule into `card_snapshots` ("card data
capture"). A "no card data captured" bug recently caused cards to silently go
missing for an extended period. Root causes were fixed and deployed (release
`20260629-093526`):

- Capture writes now use the **service-role admin client**
  (`createAdminClient`), bypassing the RLS policy that produced
  `new row violates row-level security policy … 42501` failures.
- A **durable `schedule_rows` mirror** preserves deleted/edited sheet rows.
- A **full-range nightly reconcile** (`runMirrorReconcile`) re-attempts every
  unfrozen past date, so transient failures self-heal on the next run.
- **Capture-health alerting** (`assessCaptureHealth` → Resend email to
  `SNAPSHOT_ALERT_EMAIL`) fires when a run detects an empty sheet fetch or
  unrecoverable dates.

**The remaining gap:** the existing alerting only fires *when the reconcile run
executes and detects a problem*. It **cannot fire if the run never executes** —
e.g. the systemd timer is disabled/removed, a deploy breaks the capture path so
every run throws, or the run is otherwise silently skipped. In that case capture
stops and nothing tells anyone. The `capture-alert.ts` source itself notes the
system "silently captured nothing for ~2 months" — this is that failure class.

**Goal:** detect a silently-stopped capture cron *while the app is running* and
email an alert, so the bug cannot resurface unnoticed.

## Non-Goals

- Detecting total server/box death or the Next process being down. The watchdog
  endpoint lives inside the same app it monitors, so it cannot self-report when
  the app is down. That class is independently visible (the dashboard goes dark)
  and is covered by the ops recommendation below, not by this code.
- Changing the capture logic itself (already fixed).
- Real-time (sub-day) capture or the live-dashboard refresh mechanism (separate
  concern; not part of this work).

## Approach

Internal watchdog (self-contained; chosen over an external dead-man's-switch to
avoid a third-party dependency and match existing patterns). Two independent
halves:

### 1. Heartbeat write — liveness marker

A new table records the last time the reconcile **executed successfully**
(distinct from whether capture was *healthy*):

```sql
-- supabase/migrations/016_cron_heartbeats.sql
create table cron_heartbeats (
  name text primary key,
  last_success_at timestamptz not null default now()
);
alter table cron_heartbeats enable row level security;
create policy "Authenticated can read cron_heartbeats"
  on cron_heartbeats for select using (auth.uid() is not null);
-- Seed so the watchdog has a grace window before the first real run.
insert into cron_heartbeats (name, last_success_at)
  values ('snapshot-run', now())
  on conflict (name) do nothing;
```

Writes go through the service-role admin client (no insert/update policy —
matches `schedule_rows`).

`/api/snapshot/run` writes `last_success_at = now()` for `'snapshot-run'` after
`runMirrorReconcile` returns without throwing. This is **orthogonal to
capture-health**: it records that the run executed, even on healthy days when
nothing new is frozen. It is deliberately **not** `max(card_snapshots.frozen_at)`,
which would falsely look stale on no-op days. A heartbeat-write failure is logged
and never breaks the run.

### 2. Watchdog check — the alarm

`POST /api/snapshot/watchdog` (Bearer `SNAPSHOT_CRON_TOKEN`, same auth as the
other snapshot endpoints):

1. Build the admin client; read the `'snapshot-run'` heartbeat.
2. Compute staleness via a pure function.
3. If stale (age `> 26h`, or no heartbeat row at all): log
   `[snapshot/watchdog] STALE …` and email via Resend (`buildWatchdogAlertEmail`)
   to `SNAPSHOT_ALERT_EMAIL`.
4. Return `{ stale, lastSuccessAt, ageHours }`.

A new systemd timer runs it **every 6h, independent of the capture timer**:

```ini
# speedero-snapshot-watchdog.timer
[Timer]
OnCalendar=*-*-* 00/6:00:00 America/Los_Angeles
Persistent=true
```

```ini
# speedero-snapshot-watchdog.service (oneshot)
ExecStart=/usr/bin/curl -fsS \
  -H "Authorization: Bearer ${SNAPSHOT_CRON_TOKEN}" \
  -X POST http://127.0.0.1:3000/SecApp/api/snapshot/watchdog
```

**Threshold:** `WATCHDOG_MAX_AGE_HOURS = 26` (daily cron + ~2h slack). Checked
every 6h → an alert lands within ~6h of the heartbeat going stale.

## Components & Interfaces

| Unit | Responsibility | Depends on |
|---|---|---|
| `assessHeartbeatStaleness({ lastSuccessAt, now, thresholdHours })` | Pure: returns `{ stale, ageHours }`. `null` lastSuccessAt → stale, ageHours `null`. | none (pure) |
| `recordCronHeartbeat(supabase, name)` | Upsert `{ name, last_success_at: now() }` via admin client. | Supabase admin |
| `getCronHeartbeat(supabase, name)` | Read `last_success_at` for name, or `null`. | Supabase |
| `buildWatchdogAlertEmail({ now, lastSuccessAt, ageHours })` | Pure: `{ subject, html, text }`. HTML-escaped; handles "never ran" case. | none (pure) |
| `/api/snapshot/run` (edit) | Write heartbeat on successful reconcile. | recordCronHeartbeat |
| `/api/snapshot/watchdog` (new) | Auth → read heartbeat → assess → alert. | get heartbeat, assess, email |
| systemd watchdog timer/service | Fire the watchdog endpoint every 6h. | curl, SNAPSHOT_CRON_TOKEN |

## Data Flow

```
nightly:  timer → /api/snapshot/run → runMirrorReconcile (ok)
                                    → recordCronHeartbeat('snapshot-run', now())
every 6h: timer → /api/snapshot/watchdog → getCronHeartbeat('snapshot-run')
                                         → assessHeartbeatStaleness(…)
                                         → if stale: Resend email to SNAPSHOT_ALERT_EMAIL
```

## Error Handling

- Heartbeat write failure in `/api/snapshot/run`: caught, logged
  (`[snapshot/run] heartbeat write failed`), does not fail the run.
- Watchdog email failure: caught, logged; endpoint still returns its JSON status.
- Watchdog with no heartbeat row: treated as stale (`ageHours: null`) → alerts.
  Mitigated by the migration seed so this only occurs if the row is deleted.
- Watchdog unauthorized / token unset: 401 / 503, mirroring the run route.

## Testing (TDD)

Unit tests, matching the repo's "pure logic is unit-tested; routes stay thin"
philosophy:

- `assessHeartbeatStaleness`: fresh (not stale), exactly at threshold, beyond
  threshold (stale), `null` lastSuccessAt (stale, ageHours null), age math.
- `buildWatchdogAlertEmail`: subject, HTML escaping, "never ran" wording, text
  vs html parity.
- `recordCronHeartbeat` / `getCronHeartbeat`: via injected fake Supabase
  (as existing snapshot/live-cache tests do).

Route handlers (`run` edit, `watchdog` new) are thin compositions of the tested
units, consistent with the existing untested-but-thin snapshot routes.

## Deploy (AJ's steps — not performed by implementation)

1. Apply `supabase/migrations/016_cron_heartbeats.sql` to Supabase.
2. Install the new systemd units; `systemctl enable --now
   speedero-snapshot-watchdog.timer`.
3. Confirm `SNAPSHOT_ALERT_EMAIL`, `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`,
   `SNAPSHOT_CRON_TOKEN` are set in `/data/SecApp/shared/.env.production` (already
   present as of 2026-06-29).
4. Implementation is local-only; AJ reviews via `bun run dev` before deploying.

## Recommended Complement (ops, not built here)

Point any free uptime monitor (e.g. healthchecks.io, UptimeRobot) at a SecApp
health route to cover Next-process-down / total box-death — the one class the
internal watchdog cannot self-report.
