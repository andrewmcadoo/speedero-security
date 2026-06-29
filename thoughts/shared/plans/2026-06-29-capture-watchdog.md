# Capture Watchdog (Dead-Man's Switch) Implementation Plan

## Overview

Add an internal watchdog that detects when the nightly card-capture reconcile
silently stops running (timer disabled, capture path throwing, heartbeat stale)
*while the app is up*, and emails an alert. This closes the one gap the existing
capture-health alerting cannot see: it only fires when a run *executes and
detects a problem*, never when a run *fails to execute at all*.

Design spec: `docs/superpowers/specs/2026-06-29-capture-watchdog-design.md`.

## Current State Analysis

- Capture runs nightly via `runMirrorReconcile` (`src/lib/snapshot/freeze.ts:186`),
  invoked by `POST /api/snapshot/run` (`src/app/api/snapshot/run/route.ts`),
  authenticated with `Bearer ${SNAPSHOT_CRON_TOKEN}`, driven by the
  `speedero-snapshot.timer` systemd unit.
- Capture writes use `createAdminClient()` (`src/lib/supabase/admin.ts`) —
  service role, bypasses RLS.
- Health alerting exists (`assessCaptureHealth` in `freeze.ts` →
  `buildCaptureAlertEmail` in `src/lib/email/capture-alert.ts` → `sendEmail` in
  `src/lib/email/resend.ts`), but is reachable only when the run executes.
- DB query helpers live in `src/lib/supabase/queries.ts`; the established write
  pattern is `supabase.from("schedule_rows").upsert(rows, { onConflict: "date" })`
  (`queries.ts:243`). RLS pattern for service-role-written, auth-readable tables:
  migration `015_schedule_rows.sql`.
- Tests run with `bun test` and use `bun:test`; pure logic is unit-tested and
  DB-touching code is exercised with injected fakes (`live-cache.test.ts`,
  `freeze.test.ts`, `assemble.test.ts`). Routes are thin and untested.
- Env confirmed present in prod (2026-06-29): `SNAPSHOT_ALERT_EMAIL`,
  `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `SNAPSHOT_CRON_TOKEN`,
  `SUPABASE_SERVICE_ROLE_KEY`.

### Key Discoveries
- Heartbeat must be an explicit "ran successfully" marker, **not**
  `max(card_snapshots.frozen_at)` — on healthy no-op days nothing is frozen, so
  `frozen_at` would falsely look stale. (`runMirrorReconcile` returns
  `snapshotted: []` on such days — `freeze.ts:200`.)
- `assessCaptureHealth` is wired in the run route at
  `src/app/api/snapshot/run/route.ts:37-54` — the heartbeat write slots in right
  after the reconcile result is obtained (line ~30), independent of `issues`.
- Auth + 503/401 guard pattern to copy for the watchdog route:
  `run/route.ts:11-22`.

## Desired End State

- A `cron_heartbeats` table records `last_success_at` for `'snapshot-run'`,
  updated on every successful reconcile.
- `POST /api/snapshot/watchdog` (token-auth) reads it and, if older than 26h or
  absent, emails `SNAPSHOT_ALERT_EMAIL` via Resend.
- A `speedero-snapshot-watchdog.timer` fires the endpoint every 6h, independent
  of the capture timer.
- All pure logic + DB helpers + the email builder are unit-tested; `bun test`,
  lint, and typecheck pass.

Verify: unit tests green; locally, a seeded-stale heartbeat makes the watchdog
endpoint return `{ stale: true }` and attempt an email; a fresh heartbeat returns
`{ stale: false }`.

## What We're NOT Doing

- Detecting Next-process-down or total box-death (the watchdog lives inside the
  monitored app). Documented as an ops recommendation (external uptime monitor),
  not built.
- Changing capture logic, the live-dashboard refresh, or the Apps Script webhook.
- An env-configurable threshold — `WATCHDOG_MAX_AGE_HOURS = 26` is a named const
  (YAGNI; revisit only if cadence changes).
- Deploying (migration apply + systemd install are AJ's steps).

## Implementation Approach

TDD, bottom-up: data layer + pure logic first (fully testable), then wire the
heartbeat write, then the alarm (email builder + endpoint), then the systemd
units. Each phase is independently verifiable.

---

## Phase 1: Data layer + pure staleness logic

### Overview
Migration, DB helpers, and the pure staleness function with tests.

### Changes Required

#### 1. Migration
**File**: `supabase/migrations/016_cron_heartbeats.sql` (new)
```sql
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
```

#### 2. Pure staleness logic + threshold const
**File**: `src/lib/snapshot/heartbeat.ts` (new)
```ts
export const WATCHDOG_MAX_AGE_HOURS = 26;
export const SNAPSHOT_RUN_HEARTBEAT = "snapshot-run";

export function assessHeartbeatStaleness(args: {
  lastSuccessAt: string | null;
  now: Date;
  thresholdHours: number;
}): { stale: boolean; ageHours: number | null } {
  if (!args.lastSuccessAt) return { stale: true, ageHours: null };
  const ageHours =
    (args.now.getTime() - new Date(args.lastSuccessAt).getTime()) / 3_600_000;
  return { stale: ageHours > args.thresholdHours, ageHours };
}
```

#### 3. DB helpers (co-located with sibling query helpers)
**File**: `src/lib/supabase/queries.ts` (edit — add near `upsertScheduleRows`)
```ts
export async function recordCronHeartbeat(
  supabase: SupabaseClient,
  name: string
): Promise<void> {
  const { error } = await supabase
    .from("cron_heartbeats")
    .upsert(
      { name, last_success_at: new Date().toISOString() },
      { onConflict: "name" }
    );
  if (error) console.error("recordCronHeartbeat failed:", error.message);
}

export async function getCronHeartbeat(
  supabase: SupabaseClient,
  name: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("cron_heartbeats")
    .select("last_success_at")
    .eq("name", name)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { last_success_at: string }).last_success_at;
}
```

#### 4. Tests
**File**: `src/lib/snapshot/heartbeat.test.ts` (new)
- fresh (age < threshold) → `stale: false`, numeric `ageHours`
- exactly at threshold → `stale: false` (`>` is strict)
- beyond threshold → `stale: true`
- `lastSuccessAt: null` → `stale: true`, `ageHours: null`
- age math: 30h ago with `now` fixed → `ageHours ≈ 30`

(DB helpers `recordCronHeartbeat`/`getCronHeartbeat` covered in Phase 3 route
wiring via a fake Supabase, mirroring existing fake usage; the timestamp is set
from `new Date()` so the helper test asserts table/payload shape, not exact time.)

### Success Criteria

#### Automated Verification
- [ ] `bun test src/lib/snapshot/heartbeat.test.ts` passes
- [ ] `bunx tsc --noEmit` passes
- [ ] `bun run lint` clean

#### Manual Verification
- [ ] Migration SQL reviewed for correct RLS shape vs `015_schedule_rows.sql`

**Implementation Note**: pause for confirmation before Phase 2.

---

## Phase 2: Write heartbeat on successful reconcile

### Overview
Record the heartbeat after a successful `runMirrorReconcile`.

### Changes Required

#### 1. Run route
**File**: `src/app/api/snapshot/run/route.ts` (edit)
- Import `recordCronHeartbeat` from `@/lib/supabase/queries` and
  `SNAPSHOT_RUN_HEARTBEAT` from `@/lib/snapshot/heartbeat`.
- After `const result = await runMirrorReconcile(...)` and its log line, add:
```ts
try {
  await recordCronHeartbeat(supabase, SNAPSHOT_RUN_HEARTBEAT);
} catch (e) {
  console.error("[snapshot/run] heartbeat write failed:", e);
}
```
- Placed before the `assessCaptureHealth` block; orthogonal to `issues`.

### Success Criteria

#### Automated Verification
- [ ] `bun test` passes (no regressions)
- [ ] `bunx tsc --noEmit` passes
- [ ] `bun run lint` clean

#### Manual Verification
- [ ] With local Supabase + a valid `SNAPSHOT_CRON_TOKEN`, `POST /api/snapshot/run`
      updates `cron_heartbeats.last_success_at` for `'snapshot-run'`

**Implementation Note**: pause for confirmation before Phase 3.

---

## Phase 3: Watchdog alarm — email builder + endpoint

### Overview
The alert email and the endpoint that reads the heartbeat and fires it.

### Changes Required

#### 1. Email builder (mirror `capture-alert.ts`)
**File**: `src/lib/email/watchdog-alert.ts` (new)
```ts
export interface WatchdogAlertEmail { subject: string; html: string; text: string; }

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export function buildWatchdogAlertEmail(args: {
  lastSuccessAt: string | null;
  ageHours: number | null;
}): WatchdogAlertEmail {
  const when = args.lastSuccessAt
    ? `${args.lastSuccessAt} (~${Math.round(args.ageHours ?? 0)}h ago)`
    : "never (no heartbeat recorded)";
  const subject = "⚠ SecApp capture cron may have STOPPED";
  const text =
    `SecApp's nightly snapshot reconcile has not reported success recently.\n\n` +
    `Last successful run: ${when}.\n\n` +
    `Card capture may be silently stopped. Check the speedero-snapshot.timer ` +
    `and the speedero-security journal.`;
  const html =
    `<p>SecApp's nightly snapshot reconcile has not reported success recently.</p>` +
    `<p>Last successful run: <b>${escapeHtml(when)}</b>.</p>` +
    `<p>Card capture may be silently stopped. Check ` +
    `<code>speedero-snapshot.timer</code> and the ` +
    `<code>speedero-security</code> journal.</p>`;
  return { subject, html, text };
}
```

#### 2. Watchdog endpoint
**File**: `src/app/api/snapshot/watchdog/route.ts` (new) — auth guard copied from
`run/route.ts:11-22`.
```ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronHeartbeat } from "@/lib/supabase/queries";
import {
  assessHeartbeatStaleness,
  WATCHDOG_MAX_AGE_HOURS,
  SNAPSHOT_RUN_HEARTBEAT,
} from "@/lib/snapshot/heartbeat";
import { buildWatchdogAlertEmail } from "@/lib/email/watchdog-alert";
import { sendEmail } from "@/lib/email/resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const expected = process.env.SNAPSHOT_CRON_TOKEN;
  if (!expected)
    return NextResponse.json({ error: "Watchdog not configured" }, { status: 503 });
  if ((request.headers.get("authorization") ?? "") !== `Bearer ${expected}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const supabase = createAdminClient();
    const lastSuccessAt = await getCronHeartbeat(supabase, SNAPSHOT_RUN_HEARTBEAT);
    const { stale, ageHours } = assessHeartbeatStaleness({
      lastSuccessAt,
      now: new Date(),
      thresholdHours: WATCHDOG_MAX_AGE_HOURS,
    });
    if (stale) {
      console.error(
        `[snapshot/watchdog] STALE lastSuccessAt=${lastSuccessAt} ageHours=${ageHours}`
      );
      const alertTo = process.env.SNAPSHOT_ALERT_EMAIL;
      if (alertTo) {
        try {
          await sendEmail({
            to: alertTo,
            ...buildWatchdogAlertEmail({ lastSuccessAt, ageHours }),
          });
        } catch (e) {
          console.error("[snapshot/watchdog] failed to send alert:", e);
        }
      }
    }
    return NextResponse.json({ stale, lastSuccessAt, ageHours });
  } catch (error) {
    console.error("[snapshot/watchdog] failed:", error);
    return NextResponse.json(
      { error: "Watchdog failed", detail: String(error) },
      { status: 500 }
    );
  }
}
```

#### 3. Tests
**File**: `src/lib/email/watchdog-alert.test.ts` (new)
- subject is the STOPPED line
- `lastSuccessAt: null` → text/html say "never"
- HTML escaping of the rendered timestamp string
- text and html both mention the timer/journal

**Heartbeat DB helper test** (in `heartbeat.test.ts` or a new
`queries` test): a fake `SupabaseClient` whose `.from().upsert()` / `.from()
.select().eq().maybeSingle()` record calls — assert `recordCronHeartbeat` upserts
`{ name, last_success_at }` on `cron_heartbeats` with `onConflict: "name"`, and
`getCronHeartbeat` returns the stored value / `null` on error.

### Success Criteria

#### Automated Verification
- [ ] `bun test` passes (heartbeat + watchdog-alert suites)
- [ ] `bunx tsc --noEmit` passes
- [ ] `bun run lint` clean

#### Manual Verification
- [ ] Locally, seed `cron_heartbeats` 30h stale → `POST /api/snapshot/watchdog`
      returns `{ stale: true }` and logs `STALE` (email attempted)
- [ ] Fresh heartbeat (now) → returns `{ stale: false }`, no email
- [ ] Bad/missing token → 401/503

**Implementation Note**: pause for confirmation before Phase 4.

---

## Phase 4: systemd units + deploy docs

### Overview
The independent 6h timer and operator install steps.

### Changes Required

#### 1. Timer
**File**: `scripts/deploy/speedero-snapshot-watchdog.timer` (new)
```ini
[Unit]
Description=Check that SecApp snapshot capture is still running

[Timer]
OnCalendar=*-*-* 00/6:00:00 America/Los_Angeles
Persistent=true

[Install]
WantedBy=timers.target
```

#### 2. Service
**File**: `scripts/deploy/speedero-snapshot-watchdog.service` (new)
```ini
[Unit]
Description=Speedero Security — capture watchdog
After=network-online.target speedero-security.service

[Service]
Type=oneshot
User=andrew
EnvironmentFile=/data/SecApp/shared/.env.production
ExecStart=/usr/bin/curl -fsS \
  -H "Authorization: Bearer ${SNAPSHOT_CRON_TOKEN}" \
  -X POST http://127.0.0.1:3000/SecApp/api/snapshot/watchdog
StandardOutput=journal
StandardError=journal
```
(No `Requires=speedero-security.service` — if the app is degraded the curl fails
and the unit shows failed in `systemctl --failed`, leaving a trace. The
app-down class is out of scope per the spec.)

#### 3. Deploy doc
**File**: `scripts/deploy/SETUP.md` (edit) — add a "Capture watchdog" section:
apply migration `016`; copy the two units to `/etc/systemd/system/`;
`systemctl daemon-reload`; `systemctl enable --now speedero-snapshot-watchdog.timer`;
verify with `systemctl list-timers 'speedero-*'`.

### Success Criteria

#### Automated Verification
- [ ] `bun run build` succeeds (route compiles)
- [ ] `bunx tsc --noEmit` passes
- [ ] `bun run lint` clean

#### Manual Verification (on deploy — AJ)
- [ ] `systemctl list-timers 'speedero-*'` shows the watchdog timer with a next run
- [ ] A manual `curl … /api/snapshot/watchdog` returns JSON status
- [ ] Migration `016` applied; `cron_heartbeats` exists and seeded

---

## Testing Strategy

### Unit Tests
- `assessHeartbeatStaleness`: fresh / at-threshold / stale / null / age math
- `buildWatchdogAlertEmail`: subject, "never" case, HTML escaping, text/html parity
- DB helpers via fake Supabase: upsert payload + onConflict; select/maybeSingle

### Manual Testing Steps
1. Local Supabase: run migration `016`; confirm seeded `'snapshot-run'` row.
2. `POST /api/snapshot/run` with token → heartbeat `last_success_at` advances.
3. Manually set `last_success_at` to 30h ago → `POST /api/snapshot/watchdog`
   returns `{ stale: true }`, logs `STALE`, attempts email.
4. Reset to now → watchdog returns `{ stale: false }`.
5. Wrong token → 401.

## Migration Notes
`016_cron_heartbeats.sql` is additive (new table + seed); no backfill, no
destructive change. Safe to apply independently before the units are installed.

## References
- Design spec: `docs/superpowers/specs/2026-06-29-capture-watchdog-design.md`
- Run route to mirror: `src/app/api/snapshot/run/route.ts`
- Email builder pattern: `src/lib/email/capture-alert.ts`
- RLS/table pattern: `supabase/migrations/015_schedule_rows.sql`
- Upsert pattern: `src/lib/supabase/queries.ts:224` (`upsertScheduleRows`)
- Timer/service pattern: `scripts/deploy/speedero-snapshot.{timer,service}`
