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
