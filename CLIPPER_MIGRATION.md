# Clipper Migration — Vercel → Apache (Linux)

**Scope:** This document covers moving the Speedero Security web app off Vercel and onto an Apache/Linux host ("Clipper") **and bringing it up live** on that host behind Apache + TLS. CI/CD automation (release pipelines, preview envs, automated rollback) is **out of scope** — deployment here means a one-time manual cutover.

**Audience:** An agent or engineer with fresh context. Read this top-to-bottom before taking any action.

---

## 1. What this app is

- **Framework:** Next.js `16.2.1` (App Router), React `19.2.4`
- **Runtime:** Node.js ≥ 20.9 required
- **Package manager:** `bun` (per project convention — do NOT use npm)
- **Backend services:**
  - Supabase (auth + database) via `@supabase/ssr` and `@supabase/supabase-js`
  - Google Sheets API via `googleapis` (service account)
- **Dynamic surfaces that require a running Node process:**
  - `src/middleware.ts` — Supabase session middleware, runs on every request
  - `src/app/api/schedule/route.ts` — API route
  - `src/app/auth/callback/route.ts` — Supabase auth callback
  - `src/app/auth/confirm/route.ts` — Supabase email confirmation
  - Server components throughout `src/app/**`

**Implication:** Static export is NOT possible. Apache must reverse-proxy to a long-lived `next start` Node process. There is no `output: 'export'` in `next.config.ts` and there should not be.

**No `vercel.json`** exists in the repo — so there are no cron jobs, rewrites, or Vercel-specific routes to port.

---

## 2. Pre-migration inventory (do this first)

Before touching the server, collect the following from the existing Vercel project. Record them in a secure password manager or encrypted file. **Do not commit them.**

### 2.1 Environment variables

The full list of env vars referenced in source (verified via `grep -r process.env src/`):

| Variable | Used in | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `src/lib/supabase/{server,client,admin}.ts`, `src/middleware.ts` | Public, but still required |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `src/lib/supabase/{server,client}.ts`, `src/middleware.ts` | Public |
| `SUPABASE_SERVICE_ROLE_KEY` | `src/lib/supabase/admin.ts` | **Secret** — server only |
| `GOOGLE_SHEETS_CLIENT_EMAIL` | `src/lib/google-sheets.ts:33` | Service account email |
| `GOOGLE_SHEETS_PRIVATE_KEY` | `src/lib/google-sheets.ts:34` | **Secret** — contains `\n` escapes that are unescaped at runtime via `.replace(...)`. Preserve escaped form. |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | `src/lib/google-sheets.ts:179` | Target sheet ID |

**Action:** From a workstation with Vercel CLI linked to the project:
```bash
vercel env pull .env.production.vercel
```
Then `scp` the file to Clipper. Do NOT commit it.

**Verify** nothing has been added since this doc was written:
```bash
grep -rn "process\.env\." src/
```
Any new var must be added to the list above before cutover.

### 2.2 Supabase configuration

From the Supabase dashboard for this project, record:
- Project URL (should match `NEXT_PUBLIC_SUPABASE_URL`)
- Current "Site URL" and "Redirect URLs" allowlist under **Authentication → URL Configuration**
- Any auth providers configured (Google, email, etc.)

You will need to **add** the new Clipper URL to the Redirect URLs allowlist during cutover (Section 6). Do not remove Vercel URLs until post-cutover validation passes.

### 2.3 Google Cloud configuration

From Google Cloud console for the service account referenced by `GOOGLE_SHEETS_CLIENT_EMAIL`:
- Confirm the service account still exists and the key is valid
- Confirm the target spreadsheet (`GOOGLE_SHEETS_SPREADSHEET_ID`) is shared with the service account email
- If Google OAuth (not service account) is also in use, record its authorized redirect URIs

### 2.4 Domain & DNS

- Current production domain pointing at Vercel
- DNS provider and access credentials
- TTL on the existing A/CNAME record (lower it to 300s **24h before cutover** to enable fast rollback)

### 2.5 Git state

- Confirm `main` branch of this repo matches what Vercel is currently serving. Check the Vercel dashboard's "Production Deployment" commit SHA against `git log origin/main`.
- If they differ, investigate before migrating — you may be about to ship an unreleased commit.

---

## 3. Clipper server prerequisites

The target server must have the following **before** migration begins. Verify each with the listed command; do not assume.

| Requirement | Verify with | Minimum |
|---|---|---|
| Linux (Ubuntu/Debian/RHEL) | `uname -a` | Any modern LTS |
| Node.js | `node -v` | `v20.9.0` |
| Bun | `bun -v` | `1.1+` |
| Apache 2.4 | `apache2ctl -v` | `2.4.x` — already installed on Clipper (SLES) |
| Apache modules loaded | `sudo apache2ctl -M` | `proxy`, `proxy_http`, `headers`, `ssl`, `rewrite`. On SLES, enable by editing `APACHE_MODULES` in `/etc/sysconfig/apache2` and `sudo systemctl restart apache2` — there is no `a2enmod`. |
| Git | `git --version` | any |
| Outbound HTTPS to `*.supabase.co` and `sheets.googleapis.com` | `curl -I https://sheets.googleapis.com` | 200/404 OK (not timeout) |
| A non-root service user (e.g. `www-data` or `speedero`) | `id www-data` | exists |

If any of these are missing, **stop and install them before proceeding.** Do not attempt to migrate the app onto a half-configured host.

---

## 4. Migration steps

These steps move the code + dependencies + environment onto Clipper and build the app. Sections 5–9 then bring it up live behind Apache with TLS and cut DNS over.

### 4.1 Choose install location

The app lives under Apache's document root as `SecApp`, so it is reachable at `https://clipper.speedero.com/SecApp`.

- **Clipper (SLES 15-SP7):** `/srv/www/htdocs/SecApp` — verified. Apache's `DocumentRoot` is `/srv/www/htdocs` per `/etc/apache2/default-server.conf`.
- Service user: `ec2-user` (the primary user on Clipper).

> **Note:** Apache will *not* serve the files on disk. They live under `htdocs` purely as a convention; Apache reverse-proxies `/SecApp` to the Node process on `127.0.0.1:3000`. The directory is owned by the service user, not `www-data`'s static-file ownership.

```bash
sudo mkdir -p /srv/www/htdocs/SecApp
sudo chown ec2-user:users /srv/www/htdocs/SecApp
```

### 4.2 Clone the repository

As `ec2-user`:
```bash
cd /srv/www/htdocs
# SecApp already exists and is owned by ec2-user; clone into it
rmdir SecApp && git clone <repo-url> SecApp
cd SecApp
git checkout main
git rev-parse HEAD   # record this — must match Vercel's current prod SHA
```

### 4.3 Install dependencies

```bash
bun install
```

Notes:
- `package.json` has `ignoreScripts: ["sharp", "unrs-resolver"]`. `sharp` is used by `next/image` for image optimization. On Vercel this is handled by the platform; on Clipper you likely want it installed properly:
  ```bash
  bun add sharp
  ```
  Only do this if `next/image` is used in the app (check with `grep -r "from 'next/image'" src/`). If yes, install. If no, skip.
- If `bun install` fails on a native module, fall back to `npm install` **only for that one package** and document why.

### 4.4 Place environment variables

Copy the `.env.production.vercel` file collected in Section 2.1 to the repo root as `.env.production`:
```bash
# from your workstation
scp .env.production.vercel clipper:/srv/www/htdocs/SecApp/.env.production
```

On the server:
```bash
chmod 600 /srv/www/htdocs/SecApp/.env.production
chown ec2-user:ec2-user /srv/www/htdocs/SecApp/.env.production
```

**Verify** every variable from Section 2.1 is present:
```bash
for v in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY \
         GOOGLE_SHEETS_CLIENT_EMAIL GOOGLE_SHEETS_PRIVATE_KEY GOOGLE_SHEETS_SPREADSHEET_ID; do
  grep -q "^$v=" .env.production && echo "OK  $v" || echo "MISSING  $v"
done
```

**Gotcha:** `GOOGLE_SHEETS_PRIVATE_KEY` must retain literal `\n` escape sequences — the code at `src/lib/google-sheets.ts:34` calls `.replace(/\\n/g, '\n')` to unescape at runtime. If your transport (shell, editor, scp) collapses them, Google auth will fail with a PEM parse error.

### 4.5 Configure Next.js `basePath`

The app is served at `https://clipper.speedero.com/SecApp`, not at the domain root. Next.js must know this at build time or every asset URL, route, and auth callback will 404.

Edit `next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/SecApp",
  // assetPrefix is NOT needed — basePath handles assets when served from the same origin.
};

export default nextConfig;
```

Consequences to verify in the codebase before building:

- **Hardcoded absolute paths** — search for any `href="/..."`, `router.push("/...")`, `redirect("/...")`, or `fetch("/api/...")` that assume root. With `basePath` set, Next rewrites `<Link>` and `router` calls automatically, but **raw `fetch` and `redirect` calls do NOT get rewritten** — they must be prefixed manually or use a helper. Check especially:
  - `src/middleware.ts` — any redirect targets
  - `src/app/auth/callback/route.ts` and `src/app/auth/confirm/route.ts` — the `redirectTo` they build for Supabase
  - `src/lib/supabase/*.ts` — anywhere a callback URL is constructed
- **Supabase `emailRedirectTo` / `redirectTo`** — must become `https://clipper.speedero.com/SecApp/auth/callback`, not `/auth/callback`.
- **`src/app/api/schedule/route.ts`** — if the client fetches it, the client path must be `/SecApp/api/schedule` (or use Next's helpers that respect `basePath`).

Fix anything broken here **before** §4.6. A build will succeed even with wrong redirect strings — the failures only show up at runtime after cutover, which is the worst time to find them.

### 4.6 Build

```bash
bun run build
```

Expected output: `.next/` directory created, "Compiled successfully" at the end. Record any warnings.

**If the build fails:**
- Missing env var at build time → Section 4.4 incomplete
- Node version mismatch → Section 3
- Native module error → likely `sharp` or `unrs-resolver`; see Section 4.3
- Next.js API change → this repo runs Next 16; do NOT downgrade. Read `node_modules/next/dist/docs/` for the relevant API. Per `AGENTS.md`, training data on Next may be stale.

### 4.7 Smoke-test the Node process locally on Clipper

Before wiring Apache, confirm the app runs. With `basePath: "/SecApp"`, the root `/` returns 404 — that's expected and correct.

```bash
bun run start -- -p 3000 &
sleep 3
curl -I http://127.0.0.1:3000/            # expect 404 (basePath is /SecApp)
curl -I http://127.0.0.1:3000/SecApp      # expect 200 or auth redirect
curl -I http://127.0.0.1:3000/SecApp/api/schedule
```
Kill the process after verification:
```bash
kill %1
```

**If 500s appear:** tail the output — most likely a missing env var or Supabase/Google credential mismatch. Do NOT proceed until this smoke test is clean.

### 4.8 Confirm outbound connectivity from the app

From the repo root on Clipper, run a one-off script to confirm both backends respond:
```bash
node -e "fetch(process.env.NEXT_PUBLIC_SUPABASE_URL).then(r=>console.log('supabase',r.status))" \
  --env-file=.env.production
```
Expect a 2xx/4xx (not a network error). Repeat the same pattern for `https://sheets.googleapis.com` if desired.

---

## 5. Build verification checklist

Before wiring up systemd + Apache, confirm all of the following on Clipper:

- [ ] Repo cloned at `/srv/www/htdocs/SecApp`, owned by service user
- [ ] `git rev-parse HEAD` matches the Vercel production SHA recorded in Section 2.5
- [ ] `bun install` completed with no errors
- [ ] `.env.production` exists, mode 600, contains all 6 variables from Section 2.1
- [ ] `next.config.ts` has `basePath: "/SecApp"` committed (or applied locally on Clipper and noted for upstream)
- [ ] All hardcoded auth redirect URLs updated to include `/SecApp`
- [ ] `bun run build` succeeds
- [ ] `bun run start` serves HTTP 200 on `127.0.0.1:3000/SecApp` (and 404 on `/`)
- [ ] `/SecApp/api/schedule` responds (even if with auth error — that proves the route is live)
- [ ] `sharp` installed if `next/image` is used
- [ ] Outbound requests to Supabase and Google Sheets work from the Clipper host

---

## 6. Run the app as a systemd service

Goal: keep `next start` alive on `127.0.0.1:3000` under the service user, restart on failure, start on boot.

Create `/etc/systemd/system/speedero-security.service`:

```ini
[Unit]
Description=Speedero Security (Next.js)
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/srv/www/htdocs/SecApp
EnvironmentFile=/srv/www/htdocs/SecApp/.env.production
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=127.0.0.1
ExecStart=/usr/bin/bun run start
Restart=on-failure
RestartSec=5
# Hardening
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

Notes:
- Replace `ec2-user` with the user from Section 3.
- `bun` path: verify with `which bun` — may be `/usr/local/bin/bun` or under the service user's home. Use the absolute path.
- `systemd` does NOT parse `\n` escapes inside `EnvironmentFile`. The `GOOGLE_SHEETS_PRIVATE_KEY` runtime unescape at `src/lib/google-sheets.ts:34` still applies, so the escaped form in `.env.production` is correct as-is.

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now speedero-security
sudo systemctl status speedero-security
curl -I http://127.0.0.1:3000/
journalctl -u speedero-security -n 50 --no-pager
```

Expect: `active (running)`, HTTP 200/redirect, no stack traces in the journal.

---

## 7. Apache vhost + TLS

Goal: expose the systemd-managed Node process on `:443` for the production hostname.

### 7.1 Lower DNS TTL (24h before cutover)

On your DNS provider, drop the TTL on the prod A/CNAME to 300s. Wait for the old TTL to expire before Section 7.5. This enables a fast rollback.

### 7.2 Initial HTTP vhost (pre-TLS)

On SLES, vhosts live in `/etc/apache2/vhosts.d/*.conf` (templates already present: `vhost.template`, `vhost-ssl.template`). Create `/etc/apache2/vhosts.d/secapp.conf`:

```apache
<VirtualHost *:80>
    ServerName clipper.speedero.com

    ErrorLog  ${APACHE_LOG_DIR}/secapp-error.log
    CustomLog ${APACHE_LOG_DIR}/secapp-access.log combined

    # Let certbot complete HTTP-01 before anything else
    ProxyPass        /.well-known/ !

    # Only /SecApp is proxied; the rest of the host can still serve static htdocs
    ProxyPreserveHost On
    ProxyPass        /SecApp  http://127.0.0.1:3000/SecApp
    ProxyPassReverse /SecApp  http://127.0.0.1:3000/SecApp

    RequestHeader set X-Forwarded-Proto "http"
</VirtualHost>
```

Note: `basePath` means Next.js itself serves everything under `/SecApp/...` — do NOT strip the prefix in Apache. The proxy must pass the path through unchanged.

Enable modules (SLES): edit `/etc/sysconfig/apache2` and ensure `APACHE_MODULES` contains `proxy proxy_http headers ssl rewrite socache_shmcb` (socache_shmcb is required by ssl). Then:

```bash
sudo apache2ctl configtest
sudo systemctl restart apache2
```

> **Heads-up:** Clipper already serves `/navdata`, `/chartdata`, `/VintageRadar`, and `/info.php` from `/srv/www/htdocs` on port 80. The `ProxyPass /SecApp` directive is path-scoped, so it will NOT affect those. But this vhost's `ServerName clipper.speedero.com` may collide with whatever currently handles that hostname on :80 — check `/etc/apache2/vhosts.d/` before adding a second vhost with the same name. If one already exists, **add the proxy rules inside it** instead of creating a new file.

At this point, `curl -I http://<clipper-ip>/SecApp -H 'Host: clipper.speedero.com'` from your workstation should return 200/redirect proxied from Next.

### 7.3 Obtain TLS cert

If `clipper.speedero.com` does not yet resolve to Clipper publicly, certbot's HTTP-01 will fail. Two options:

- **Option A (preferred): DNS-01 challenge** — `sudo certbot certonly --manual --preferred-challenges dns -d clipper.speedero.com`. Works without any DNS pointing at Clipper yet.
- **Option B: point DNS first**, then run `sudo certbot --apache -d clipper.speedero.com`. Simpler if `clipper.speedero.com` is a brand-new hostname that was never on Vercel anyway (no user impact from pointing it straight at Clipper).

Either way, end with certs under `/etc/letsencrypt/live/clipper.speedero.com/`.

### 7.4 HTTPS vhost

Replace the vhost file with:

```apache
<VirtualHost *:80>
    ServerName clipper.speedero.com
    RewriteEngine On
    RewriteCond %{HTTPS} off
    RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
</VirtualHost>

<VirtualHost *:443>
    ServerName clipper.speedero.com

    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/clipper.speedero.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/clipper.speedero.com/privkey.pem

    ErrorLog  ${APACHE_LOG_DIR}/secapp-error.log
    CustomLog ${APACHE_LOG_DIR}/secapp-access.log combined

    # Only /SecApp is proxied to Next. Everything else can still serve from htdocs
    # (or add a redirect so bare hits to / land on /SecApp — see note below).
    ProxyPreserveHost On
    ProxyPass        /SecApp  http://127.0.0.1:3000/SecApp
    ProxyPassReverse /SecApp  http://127.0.0.1:3000/SecApp

    # Next.js needs to know the original scheme/host so auth callbacks and
    # absolute-URL generation use https://clipper.speedero.com, not http://127.0.0.1.
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Host  "%{HTTP_HOST}s"

    # Optional: redirect bare root to /SecApp so users typing the hostname land in the app
    RedirectMatch 302 "^/$" "/SecApp"
</VirtualHost>
```

```bash
sudo apache2ctl configtest
sudo systemctl reload apache2
```

### 7.5 Update Supabase auth allowlist

In the Supabase dashboard → **Authentication → URL Configuration**, add (do NOT remove the Vercel entries yet):

- Site URL: `https://clipper.speedero.com/SecApp`
- Redirect URLs:
  - `https://clipper.speedero.com/SecApp/auth/callback`
  - `https://clipper.speedero.com/SecApp/auth/confirm`

If Google OAuth is in use, add `https://clipper.speedero.com/SecApp/auth/callback` to the Google Cloud OAuth client's authorized redirect URIs.

**The `/SecApp` prefix is mandatory here** — Supabase strict-matches the redirect URL, and the app's callbacks live at `/SecApp/auth/callback` once `basePath` is set.

### 7.6 Pre-cutover live test from your workstation

Before touching DNS, test by forcing the hostname to Clipper locally:
```bash
curl -I --resolve clipper.speedero.com:443:<clipper-ip> https://clipper.speedero.com/SecApp
curl -I --resolve clipper.speedero.com:443:<clipper-ip> https://clipper.speedero.com/SecApp/api/schedule
```
Expect 200/redirect, valid cert, no proxy errors. Then in a browser, use `--host-resolver-rules` or `/etc/hosts` to log in end-to-end (including the Supabase auth callback). Do NOT proceed until a full login works.

### 7.7 DNS cutover

Create/update the A record for `clipper.speedero.com` to point at Clipper's IP. Watch `journalctl -u speedero-security -f` and the Apache access log.

Verify from a clean network:
```bash
dig +short clipper.speedero.com
curl -I https://clipper.speedero.com/SecApp
```

If the existing Vercel-hosted app uses a *different* hostname (e.g. `app.speedero.com`), it is untouched by this cutover — users keep hitting Vercel until you decide to retire it. If `clipper.speedero.com` is a new hostname, there is no traffic to cut over: creating the DNS record simply makes the new URL reachable.

---

## 8. Post-cutover verification checklist

- [ ] `systemctl is-active speedero-security` → `active`
- [ ] `curl -I https://clipper.speedero.com/SecApp` → 200/redirect with valid TLS
- [ ] `https://clipper.speedero.com/SecApp` loads in a browser with working CSS/JS (no 404s on `_next/static` — that would mean `basePath` is misconfigured)
- [ ] Browser login flow works end-to-end (Supabase callback lands at `/SecApp/auth/callback` on Clipper)
- [ ] `/SecApp/api/schedule` responds correctly for an authenticated user
- [ ] Google Sheets-backed features load data
- [ ] No repeated errors in `journalctl -u speedero-security` or Apache error log
- [ ] Vercel deployment still reachable via its `*.vercel.app` URL (rollback path intact)

Once all of the above have held for a reasonable bake period, raise DNS TTL back to its previous value and remove the Vercel redirect URLs from Supabase. Decommission the Vercel project only after that.

---

## 9. Rollback

Because DNS TTL was lowered in Section 7.1 and Vercel was left untouched:

1. Revert the prod A/CNAME to the original Vercel target.
2. Wait for TTL to expire (≤300s).
3. Leave Clipper files in place for debugging; `sudo systemctl stop speedero-security` if you want the port free.

Supabase redirect URLs can stay — extra entries are harmless. No data migration happened, so there's nothing to undo on the database side.

---

## 10. References

- `package.json` — dependency + script definitions
- `next.config.ts` — Next config (currently empty; dynamic mode)
- `src/middleware.ts` — Supabase session middleware
- `src/lib/supabase/{server,client,admin}.ts` — Supabase clients
- `src/lib/google-sheets.ts` — Google Sheets integration
- `AGENTS.md` — project reminder that Next 16 APIs may differ from training data; consult `node_modules/next/dist/docs/`
