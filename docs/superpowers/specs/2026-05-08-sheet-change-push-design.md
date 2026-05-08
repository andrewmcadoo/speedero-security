# Sheet Change Push: Near-Instant Sync from Google Sheets

**Date:** 2026-05-08
**Status:** Approved (design)
**Author:** AJ + Claude

## Problem

Users report a confusing lag between editing the master Google Sheet and seeing those changes in the dashboard. Two failure modes:

1. **Reload path:** A user edits the Sheet, reloads the dashboard, but the server cache (`live-cache.ts`: 10s fresh / 60s stale-while-revalidate) hands them stale data for up to ~60s.
2. **Open-tab path:** A user keeps the dashboard open and expects it to update on its own. The main dashboard has no auto-refresh; only `/admin/users` mounts `AutoRefresh`, and even that polls a separate concern.

Goal: edits to the Sheet propagate to all open dashboards in **~1.5–3s** (common case), without introducing constant client polling.

## Constraints

- **Single-node deploy** — runs as one Next.js process behind Apache on Clipper (`clipper.speedero.com/SecApp`). Multi-instance is not in scope.
- **No new infra dependency** — Supabase Realtime is not used today; we're not adding it for this feature.
- **Apache reverse proxy** — Apache buffers responses by default and that breaks SSE; deploy config must disable buffering for the SSE route.
- **Existing cache contract** — `invalidateLiveSourcesCache()` already exists and is called from server actions. Sheet-change must use the same invalidation path.

## Approach: Apps Script `onEdit` → webhook → SSE push

Edits in the Sheet fire an installable `onEdit` Apps Script trigger, which HMAC-POSTs a Next.js webhook. The webhook invalidates the live-sources cache and broadcasts a "changed" event to an in-process SSE hub. Dashboard tabs hold an `EventSource` connection to that hub; on event, they call `router.refresh()`.

```
Sheet edit
   │
   ▼ Apps Script onEdit (installable trigger, fires ~1–2s)
HMAC-signed POST → /api/sheet-changed
   │
   ▼ verify HMAC → invalidateLiveSourcesCache() → broadcastChanged()
in-process SSE hub  Set<Subscriber>
   │
   ▼ "changed" event
GET /api/changes (text/event-stream, auth-gated)
   │
   ▼ EventSource onmessage
<SheetChangeListener> → router.refresh() (debounced)
   │
   ▼ RSC re-render → fetchAllLiveSourcesCached() → cache MISS → fresh Sheets fetch
```

### Why this over alternatives

- **Fast polling + cache-bust webhook (rejected):** would need ~1–2s polling cadence on every dashboard tab forever. Wasteful when the Sheet is idle, which is the common case. SSE adds one persistent socket that does nothing until something changes.
- **Drive API `files.watch` (rejected):** notifications can lag seconds-to-minutes per Google's docs, and channels expire and need renewal cron. Variance kills the "near-instant" target.
- **Supabase Realtime as broker (rejected for now):** introduces a third dependency for a single-node deploy. Hub interface is intentionally minimal so this becomes a one-file swap if we ever go multi-instance.

## Components

| File | Purpose |
|---|---|
| `apps-script/onSheetEdit.gs` | Installable `onEdit` trigger bound to the Sheet; HMAC-POSTs to webhook |
| `src/app/api/sheet-changed/route.ts` | Verifies HMAC; invalidates cache; broadcasts |
| `src/lib/sse/hub.ts` | Module-level singleton: `subscribe(s)`, `broadcastChanged()`, debounced |
| `src/app/api/changes/route.ts` | Auth-gated SSE endpoint, subscribes request to hub |
| `src/components/sheet-change-listener.tsx` | Client component, opens `EventSource`, debounces `router.refresh()` |

### Server: `src/lib/sse/hub.ts`

```ts
type Subscriber = {
  id: string;
  send: (event: string, data: string) => void;
  close: () => void;
};

const subscribers = new Set<Subscriber>();
const DEBOUNCE_MS = 400; // coalesce rapid edits into one broadcast

export function subscribe(s: Subscriber): () => void {
  subscribers.add(s);
  return () => subscribers.delete(s);
}

export function broadcastChanged(): void {
  // leading + trailing-edge debounce: first call fires immediately,
  // subsequent calls within the window collapse into one trailing broadcast.
}

export function _statsForTest(): { count: number } {
  return { count: subscribers.size };
}
```

- Plain singleton — single Clipper node means no cross-process coordination.
- Debounce is leading + trailing edge: latest data always wins, but a 30-cell paste produces one client refresh, not 30.
- `id` is a UUID for logging only; nothing is keyed off it.

### Server: `/api/sheet-changed/route.ts`

```ts
export async function POST(req: NextRequest): Promise<Response> {
  const sig = req.headers.get("x-signature");
  const body = await req.text();
  if (!sig || !verifyHmac(body, sig, process.env.SHEET_WEBHOOK_SECRET)) {
    return new Response("forbidden", { status: 403 });
  }
  invalidateLiveSourcesCache();
  broadcastChanged();
  return new Response("ok");
}
```

- HMAC-SHA256 over raw body, secret in `SHEET_WEBHOOK_SECRET`.
- Order matters: invalidate **before** broadcast, so the client's `router.refresh()` re-renders against a cache miss.
- Body is empty `""` in normal use; the existence of an authenticated POST is the entire signal.
- No replay protection. Idempotent endpoint; worst case of replay is a redundant fresh fetch.

### Server: `/api/changes/route.ts` (SSE)

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const unsub = subscribe({
        id: crypto.randomUUID(),
        send: (event, data) =>
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`)),
        close: () => controller.close(),
      });
      const heartbeat = setInterval(
        () => controller.enqueue(encoder.encode(`: ping\n\n`)),
        25_000
      );
      // cleanup on disconnect: clearInterval(heartbeat); unsub();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
```

- Auth-gated by Supabase session — anonymous clients can't drain server resources.
- `runtime = "nodejs"` and `dynamic = "force-dynamic"` are required for long-lived streams.
- Heartbeat every 25s defeats idle proxy timeouts.
- `X-Accel-Buffering: no` plus matching Apache config (below) are both required.

### Client: `src/components/sheet-change-listener.tsx`

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function SheetChangeListener() {
  const router = useRouter();

  useEffect(() => {
    let refreshing = false;
    let pending = false;

    const runRefresh = () => {
      if (refreshing) { pending = true; return; }
      refreshing = true;
      router.refresh();
      setTimeout(() => {
        refreshing = false;
        if (pending) { pending = false; runRefresh(); }
      }, 500);
    };

    const es = new EventSource("/api/changes");
    es.addEventListener("changed", runRefresh);
    return () => es.close();
  }, [router]);

  return null;
}
```

- No render output; pure side-effect.
- Client-side debounce mirrors server-side: prevents stacked refreshes if events arrive while RSC re-render is in flight.
- `EventSource` handles reconnect natively (exponential backoff).
- **No tab-visibility gating.** The connection is cheap, and a backgrounded tab finding itself stale on resume is the original complaint. Revisit if it becomes a resource issue.

### Mounting

`SheetChangeListener` mounts in `src/app/dashboard/layout.tsx` (creating it if it doesn't exist) so both EPO and Management dashboards inherit it. Not mounted globally — login pages don't need it, and the SSE endpoint requires auth anyway.

### Server actions broadcast too

The server actions in `src/app/dashboard/actions.ts` that already call `invalidateLiveSourcesCache()` get a one-line addition: `broadcastChanged()` after invalidation. This makes admin edits inside the app (assignments, EPO changes) propagate to other open tabs without waiting for any Sheets round-trip. Six call sites identified: lines 77, 113, 150, 197, 248, 280.

## Apps Script

```js
// apps-script/onSheetEdit.gs (bound to the master schedule sheet)

const WEBHOOK_URL = 'https://clipper.speedero.com/SecApp/api/sheet-changed';

function getSecret_() {
  return PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
}

function onSheetEdit(e) {
  const body = '';
  const secret = getSecret_();
  if (!secret) return;

  const sigBytes = Utilities.computeHmacSha256Signature(body, secret);
  const sig = sigBytes
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2))
    .join('');

  try {
    UrlFetchApp.fetch(WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: body,
      headers: { 'X-Signature': sig },
      muteHttpExceptions: true,
    });
  } catch (err) {
    console.warn('sheet webhook failed', err);
  }
}
```

The function is named `onSheetEdit`, **not** `onEdit`, deliberately. The name `onEdit` reserves the simple trigger, which can't make external HTTP calls. We need an **installable** trigger that runs as the user who created it and *can* call `UrlFetchApp`.

### One-time trigger setup

In the Apps Script editor:

1. Triggers (clock icon) → Add Trigger
2. Function: `onSheetEdit`
3. Event source: `From spreadsheet`
4. Event type: `On edit`
5. Save → grant `UrlFetchApp` scope when prompted

Script Properties: set `WEBHOOK_SECRET` to the same value as `SHEET_WEBHOOK_SECRET` on the server.

## Deployment

### Env vars

```
# .env.production on Clipper
SHEET_WEBHOOK_SECRET=<32-byte random hex, generated once>
```

Same value goes into Apps Script's Script Properties. Generated by AJ; not committed.

### Apache reverse proxy config

The SSE endpoint requires Apache to *not* buffer the response. Add to the SecApp vhost:

```apache
<Location /SecApp/api/changes>
    ProxyPass http://127.0.0.1:3000/SecApp/api/changes
    ProxyPassReverse http://127.0.0.1:3000/SecApp/api/changes
    SetEnv proxy-sendchunked 1
    SetEnv proxy-nokeepalive 0
    SetEnv no-buffering 1
</Location>
```

Verify required modules before deploy:

```bash
ssh clipper "apachectl -M | grep -E 'proxy_module|proxy_http_module'"
```

Both should be loaded already since the app is already reverse-proxied. If missing, edit `APACHE_MODULES` in `/etc/sysconfig/apache2` (per CLIPPER.md, no `a2enmod` on SLES) and `sudo systemctl restart apache2`.

## Testing

| Test | Asserts |
|---|---|
| `lib/sse/hub.test.ts` — subscribe/broadcast | `broadcastChanged()` enqueues on every active subscriber; unsubscribed don't receive |
| `lib/sse/hub.test.ts` — debounce | 30 calls within 400ms → exactly one broadcast per subscriber |
| `lib/sse/hub.test.ts` — trailing edge | Burst + lone edit 500ms later → 2 broadcasts (latest data wins) |
| `lib/sse/hub.test.ts` — unsubscribe | Returned unsub removes subscriber |
| `api/sheet-changed.test.ts` — HMAC happy path | Valid sig → invalidate + broadcast called, 200 |
| `api/sheet-changed.test.ts` — HMAC reject | Bad sig → 403, no invalidation, no broadcast |
| `api/sheet-changed.test.ts` — order | Invalidation precedes broadcast (regression guard) |
| Manual smoke | Edit Sheet cell with two browser tabs open → both refresh in ~3s |

Not unit-tested: `EventSource` reconnect (browser native), Apache buffering (deploy-time smoke).

## Edge cases

- **Server restart while SSE is connected.** `EventSource` reconnects automatically; if the restart coincides with a Sheet edit, the *next* page render hits an invalidated cache (fresh data). Worst case: brief stale render, self-corrects on next edit.
- **Webhook arrives mid-render.** Cache invalidation is synchronous (just nulls the singleton), so no race. The render in flight finishes with prior data; next render sees fresh.
- **Two webhook POSTs race.** Both invalidate (idempotent), both broadcast — debouncer collapses them. Safe.
- **HMAC replay.** Idempotent endpoint; worst case is a redundant cache fetch. Not worth nonce/timestamp complexity.
- **HTTPS later.** Apache is HTTP-only today (per CLIPPER.md). SSE works over HTTP fine. When TLS lands, no app-side change needed.

## Out of scope

- **Multi-instance / serverless deploy.** If we ever leave Clipper, swap `lib/sse/hub.ts` for a Supabase Realtime channel — the `subscribe`/`broadcastChanged` interface is intentionally minimal.
- **`AutoRefresh` on `/admin/users`.** Different data source (DB, not Sheets). Leave as-is.
- **Granular events (which row changed).** Broadcast `"changed"` and re-render everything. Targeted invalidation is a future optimization if RSC cost becomes meaningful.
- **Apps Script `onChange` (structural events: row insert/delete).** `onEdit` covers cell edits, which is the reported pain. Add a second trigger if row inserts/deletes turn out to also need notification.
- **API-driven Sheet writes.** Apps Script `onEdit` doesn't fire for them. The 60s cache TTL still acts as a safety net. If/when something programmatically writes to the Sheet, it should call the webhook directly.

## Honest limits

- **Latency target ~1.5–3s** is dominated by Apps Script trigger fire time (typically 1–2s, occasionally up to 5s under load), not our hop. End-to-end is bound by what Google delivers.
- **Trigger ownership.** If the user who installed the trigger loses Sheet access, the trigger silently stops firing. Document this. Use a long-term owner (AJ or a service account).
- **Apps Script daily quota** (~6 min runtime/day free, much higher for Workspace). Each `UrlFetchApp` is sub-second; thousands of edits/day before this matters.
