<!-- scripts/deploy/SHEET_CHANGE_PUSH.md -->
# Sheet Change Push — Deploy Notes

End-to-end flow:
- Sheet edit → Apps Script `onSheetEdit` → POST `/api/sheet-changed` (HMAC) → cache invalidate + SSE broadcast → open dashboards `router.refresh()`.

## 1. Generate the shared secret (once)

```bash
openssl rand -hex 32
```

Use the same value in **both** places below. Don't commit it.

## 2. Server: set `SHEET_WEBHOOK_SECRET`

Add to `/data/SecApp/shared/.env.production` on Clipper:

```
SHEET_WEBHOOK_SECRET=<same 32-byte hex from step 1>
```

Restart the Next.js process so it picks up the env var.

## 3. Apache: disable buffering for `/api/changes`

The SSE endpoint must stream byte-for-byte. Default Apache `mod_proxy_http`
buffers responses, which makes the client see nothing until the connection
closes. Add this `<Location>` block inside the SecApp vhost
(`/etc/apache2/vhosts.d/secapp.conf` or wherever the vhost lives — see
`CLIPPER.md`):

```apache
<Location /SecApp/api/changes>
    ProxyPass         http://127.0.0.1:3000/SecApp/api/changes
    ProxyPassReverse  http://127.0.0.1:3000/SecApp/api/changes
    SetEnv            proxy-sendchunked 1
    SetEnv            no-buffering 1
</Location>
```

Verify required modules are loaded:

```bash
ssh clipper "apachectl -M | grep -E 'proxy_module|proxy_http_module'"
```

Both should appear. If missing, edit `APACHE_MODULES` in
`/etc/sysconfig/apache2` (per `CLIPPER.md` — there is no `a2enmod` on SLES)
and `sudo systemctl restart apache2`.

Reload Apache after the vhost change:

```bash
ssh clipper "sudo systemctl reload apache2"
```

## 4. Apps Script: install bound script + trigger

In the master schedule sheet:

1. Extensions → Apps Script.
2. Paste `scripts/deploy/onSheetEdit.gs` into `Code.gs`. Save.
3. Project Settings (gear icon) → Script Properties → Add:
   - `WEBHOOK_SECRET` = `<same value as step 1>`
4. Triggers (clock icon) → Add Trigger:
   - Function: `onSheetEdit`
   - Event source: `From spreadsheet`
   - Event type: `On edit`
5. Save → on the OAuth consent screen, grant `UrlFetchApp` scope.

The trigger runs as the user who installed it. If that user loses Sheet
access, the trigger silently stops firing — use a long-lived owner.

## 5. Verify

1. Sign in to the dashboard in a browser tab.
2. Edit any cell on the master schedule sheet.
3. Tab should refresh within ~1.5–3s.

If it doesn't:
- Check Apps Script execution log (Apps Script editor → Executions) — look
  for `onSheetEdit` runs and any non-2xx responses.
- Check Next.js logs on Clipper for `403 forbidden` (HMAC mismatch).
- `curl -N` the SSE endpoint while authenticated to confirm Apache isn't
  buffering.
