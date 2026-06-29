# Clipper deploy — one-time setup

The `deploy.sh` script assumes the release-dir layout exists on Clipper. These
steps migrate the current single-directory install at `/data/SecApp/` into it.
Run **once**, per-server.

```
/data/SecApp/
  current -> releases/<ts>   # symlink, flipped atomically on deploy
  releases/<ts>/             # each build lives here
  shared/.env.production     # env file, shared across releases
```

## 1. Stash the current install

```bash
ssh clipper
sudo systemctl stop speedero-security

cd /data/SecApp
sudo mkdir -p releases shared
sudo mv .env.production shared/.env.production

# Move everything else aside — we'll re-deploy cleanly below.
sudo mv ../SecApp ../SecApp.old
sudo mkdir -p /data/SecApp/releases /data/SecApp/shared
sudo mv /data/SecApp.old/shared/.env.production /data/SecApp/shared/.env.production

sudo chown -R andrew:users /data/SecApp
```

(Keep `/data/SecApp.old` around for a week, then `sudo rm -rf /data/SecApp.old`
once you're confident deploys work.)

## 2. Install the new systemd unit

From your laptop:

```bash
scp scripts/deploy/speedero-security.service clipper:/tmp/speedero-security.service
ssh clipper 'sudo mv /tmp/speedero-security.service /etc/systemd/system/ && sudo systemctl daemon-reload'
```

Verify no syntax errors:

```bash
ssh clipper 'sudo systemd-analyze verify speedero-security.service'
```

## 3. Grant andrew passwordless sudo for the one restart command

`deploy.sh` calls `sudo -n systemctl restart speedero-security` over ssh — it
can't prompt for a password. Add this to sudoers:

```bash
ssh clipper
sudo visudo -f /etc/sudoers.d/speedero-security
```

Paste:

```
andrew ALL=(root) NOPASSWD: /usr/bin/systemctl restart speedero-security
```

## 4. First deploy

From your laptop, on the `clipper` branch at the tip you want to ship:

```bash
scripts/deploy/deploy.sh
```

The first run:
- streams source into `/data/SecApp/releases/<ts>/`
- installs + builds (this is the slow step — old service is currently stopped,
  so there's brief downtime on the very first deploy only)
- creates the `current` symlink
- starts the service

Verify:

```bash
curl -I https://clipper.speedero.com/SecApp
ssh clipper 'sudo systemctl status speedero-security --no-pager'
ssh clipper 'sudo journalctl -u speedero-security -n 50 --no-pager'
```

## Subsequent deploys

Just run `scripts/deploy/deploy.sh` — no downtime during build, ~2s on restart.

## Rollback

```bash
ssh clipper
ls -1t /data/SecApp/releases/   # find the previous release
sudo -u andrew ln -sfn /data/SecApp/releases/<previous-ts> /data/SecApp/current.new
sudo -u andrew mv -Tf /data/SecApp/current.new /data/SecApp/current
sudo systemctl restart speedero-security
```

## Nightly snapshot timers

The dashboard freezes past cards into `card_snapshots` via systemd timers that
POST to loopback endpoints. Install on Clipper once.

### Two timers, defense in depth

The system uses two timers:

- **23:55 PT** (`speedero-snapshot-prerollover.timer`): captures today's data
  before midnight rollover. By the time today rolls to yesterday, the snapshot
  is already populated, eliminating the race window where the dashboard's
  first post-midnight load could fail to lazy-backfill (e.g., Sheets API
  cold-start).
- **00:30 PT** (`speedero-snapshot.timer`): catches anything the pre-rollover
  missed (e.g., if the 23:55 fire was skipped because the server was down)
  by re-checking the prior 7 days.

Both are idempotent — if a date is already frozen, the run skips it.

### Install

1. Generate a token and add it to the env file:
   ```bash
   token=$(openssl rand -hex 32)
   echo "SNAPSHOT_CRON_TOKEN=$token" | sudo tee -a /data/SecApp/shared/.env.production
   ```
2. Restart the app so it picks up the new var:
   ```bash
   sudo systemctl restart speedero-security
   ```
3. Install both timer + service unit pairs:
   ```bash
   sudo cp /data/SecApp/current/scripts/deploy/speedero-snapshot.service /etc/systemd/system/
   sudo cp /data/SecApp/current/scripts/deploy/speedero-snapshot.timer /etc/systemd/system/
   sudo cp /data/SecApp/current/scripts/deploy/speedero-snapshot-prerollover.service /etc/systemd/system/
   sudo cp /data/SecApp/current/scripts/deploy/speedero-snapshot-prerollover.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now speedero-snapshot.timer
   sudo systemctl enable --now speedero-snapshot-prerollover.timer
   ```
4. Sanity-check both timers:
   ```bash
   systemctl list-timers speedero-snapshot.timer speedero-snapshot-prerollover.timer
   sudo systemctl start speedero-snapshot.service               # fire lookback once, immediately
   sudo systemctl start speedero-snapshot-prerollover.service   # fire pre-rollover once, immediately
   sudo journalctl -u speedero-snapshot -u speedero-snapshot-prerollover --since "5 min ago"
   ```
   Expected log lines include `snapshotted=[...]` etc.

### Token rotation

`speedero-security.service`, `speedero-snapshot.service`, and
`speedero-snapshot-prerollover.service` all load
`/data/SecApp/shared/.env.production`. To rotate:

```bash
new_token=$(openssl rand -hex 32)
sudo sed -i "s/^SNAPSHOT_CRON_TOKEN=.*/SNAPSHOT_CRON_TOKEN=$new_token/" /data/SecApp/shared/.env.production
sudo systemctl restart speedero-security
# Both timers will pick up the new token on their next fire; no restart needed for the timers themselves.
```

## Capture watchdog (dead-man's switch)

The nightly reconcile records a liveness heartbeat (`cron_heartbeats`,
`name='snapshot-run'`) on every successful run. An independent watchdog timer
fires every 6h, reads the heartbeat, and emails `SNAPSHOT_ALERT_EMAIL` via Resend
if it is older than 26h (or missing). This closes the one gap the run-time
capture-health alert cannot see: a cron that has **silently stopped executing**
(timer disabled/removed, capture path throwing on every run).

It does **not** cover the Next process being down or total box death — the
watchdog lives inside the app it monitors. Point an external uptime monitor
(e.g. healthchecks.io, UptimeRobot) at a SecApp route to cover that class.

### Install

1. Apply the migration so the heartbeat table exists and is seeded:

   ```bash
   # Apply supabase/migrations/016_cron_heartbeats.sql to Supabase
   # (creates cron_heartbeats + seeds 'snapshot-run' with now()).
   ```

2. Confirm the alert env is present in `/data/SecApp/shared/.env.production`
   (already set as of 2026-06-29): `SNAPSHOT_ALERT_EMAIL`, `RESEND_API_KEY`,
   `RESEND_FROM_ADDRESS`, `SNAPSHOT_CRON_TOKEN`.

3. Install the watchdog timer + service unit pair:

   ```bash
   sudo cp /data/SecApp/current/scripts/deploy/speedero-snapshot-watchdog.service /etc/systemd/system/
   sudo cp /data/SecApp/current/scripts/deploy/speedero-snapshot-watchdog.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now speedero-snapshot-watchdog.timer
   ```

4. Sanity-check:

   ```bash
   systemctl list-timers 'speedero-*'                         # watchdog timer shows a next run
   sudo systemctl start speedero-snapshot-watchdog.service     # fire once, immediately
   sudo journalctl -u speedero-snapshot-watchdog --since "5 min ago"
   ```

   A fresh heartbeat returns `{"stale":false,...}` and sends no email. To verify
   the alarm path, set `cron_heartbeats.last_success_at` for `'snapshot-run'` to
   ~30h ago, fire the service, and confirm a `STALE` journal line + alert email;
   then let the next nightly run reset it.

The watchdog service loads the same `/data/SecApp/shared/.env.production`, so the
token-rotation steps above cover it too.
