#!/usr/bin/env bash
# Deploy this repo to clipper:/data/SecApp using the release-dir pattern.
#
#   scripts/deploy/deploy.sh            # deploys origin/clipper
#   scripts/deploy/deploy.sh <ref>      # deploys any ref
#
# What happens:
#   1. git archive <ref> is streamed to clipper:/data/SecApp/releases/<ts>/
#   2. bun install + bun run build run there (old release keeps serving)
#   3. On success, /data/SecApp/current symlink is flipped (atomic rename)
#   4. speedero-security systemd service is restarted (~2s downtime)
#   5. Oldest releases pruned, keeping the 5 most recent
#
# If the build fails, the service is NOT restarted and the old release keeps
# serving. The failed release dir is left in place for debugging.

set -euo pipefail

REF="${1:-origin/clipper}"
REMOTE="clipper"
APP_DIR="/data/SecApp"
KEEP=5
TS="$(date -u +%Y%m%d-%H%M%S)"
RELEASE_DIR="${APP_DIR}/releases/${TS}"

echo "[deploy] fetching origin..."
git fetch origin

SHA="$(git rev-parse --short=12 "${REF}")"
echo "[deploy] deploying ${REF} (${SHA}) to ${REMOTE}:${RELEASE_DIR}"

echo "[deploy] streaming source..."
ssh "${REMOTE}" "mkdir -p ${RELEASE_DIR}"
git archive "${REF}" | ssh "${REMOTE}" "tar -xC ${RELEASE_DIR}"

echo "[deploy] building on server (this takes a while; old release still serving)..."
ssh "${REMOTE}" bash <<REMOTE
set -euo pipefail
export PATH="\$HOME/.bun/bin:\$PATH"

cd "${RELEASE_DIR}"

# Next.js reads .env.production at build AND runtime; share via symlink so
# secrets live outside release dirs.
ln -s "${APP_DIR}/shared/.env.production" .env.production

bun install --frozen-lockfile
bun run build

# Atomic swap: create a temp symlink, then rename over the current one.
ln -sfn "${RELEASE_DIR}" "${APP_DIR}/current.new"
mv -Tf "${APP_DIR}/current.new" "${APP_DIR}/current"

sudo -n systemctl restart speedero-security

# Prune: keep the ${KEEP} newest release dirs, delete the rest.
cd "${APP_DIR}/releases"
ls -1t | tail -n +$(( ${KEEP} + 1 )) | xargs -r rm -rf
REMOTE

echo "[deploy] done — ${SHA} live at https://clipper.speedero.com/SecApp"
