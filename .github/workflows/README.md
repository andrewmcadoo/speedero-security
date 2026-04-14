# deploy-clipper.yml — one-time setup

Builds on `ubuntu-latest`, ships Next.js standalone output to `clipper:/data/SecApp/`,
atomic-swaps the `current` symlink, restarts `speedero-security.service`.

## Required GitHub Secrets

Repo → Settings → Secrets and variables → Actions → New repository secret.

| Name | Value |
| ---- | ----- |
| `CLIPPER_SSH_KEY` | Private key of the ed25519 deploy keypair (full PEM, multi-line) |
| `CLIPPER_HOST_KEY` | Server's public host key line (from `ssh-keyscan clipper.speedero.com`) |
| `NEXT_PUBLIC_SUPABASE_URL` | From `.env.local` / `.env.production` (same value) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From `.env.local` / `.env.production` (same value) |

Both `NEXT_PUBLIC_*` vars are inlined at build time; their "public" label means
they end up in the client bundle. Not secrets in the secrecy sense, but kept in
GH secrets to avoid hardcoding URLs in version control.

## Generate the deploy keypair

```bash
# Locally
ssh-keygen -t ed25519 -f ~/.ssh/clipper-gh-deploy -N '' -C 'github-actions@clipper-deploy'

# Authorize on server
ssh-copy-id -i ~/.ssh/clipper-gh-deploy.pub clipper

# Grab host key for known_hosts
ssh-keyscan clipper.speedero.com 2>/dev/null | grep -E '^[^ ]+ ssh-ed25519' | head -1
# ^ paste that single line as CLIPPER_HOST_KEY

# Paste contents of ~/.ssh/clipper-gh-deploy (the private key, -----BEGIN OPENSSH...) as CLIPPER_SSH_KEY
```

## Server prerequisites

- `andrew` has `NOPASSWD: ALL` sudo (already true)
- `/data/SecApp/shared/.env.production` exists (already true)
- `/etc/systemd/system/speedero-security.service` is the standalone version
  from `scripts/deploy/speedero-security.service` (see instructions in
  `scripts/deploy/SETUP.md` for how to install it)

## Rollback

```bash
ssh clipper
ls -1t /data/SecApp/releases/   # find previous
ln -sfn /data/SecApp/releases/<previous-ts> /data/SecApp/current.new
mv -Tf /data/SecApp/current.new /data/SecApp/current
sudo systemctl restart speedero-security
```
