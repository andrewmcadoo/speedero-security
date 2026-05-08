# Sheet Change Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Propagate Google Sheet edits to all open dashboards in ~1.5–3s by replacing the current "edit → wait up to 60s of cache → manually reload" path with an Apps Script → webhook → SSE push.

**Architecture:** An installable `onEdit` Apps Script trigger HMAC-POSTs `/api/sheet-changed` on every Sheet edit. The webhook invalidates the existing live-sources cache and broadcasts to an in-process SSE hub. Dashboards hold an `EventSource` connection to `/api/changes`; on event they call `router.refresh()`, which triggers an RSC re-render against the now-empty cache (cache miss → fresh Sheets fetch).

**Tech Stack:** Next.js 16 (App Router, RSC + server actions), TypeScript, `@supabase/ssr`, Bun (`bun test` runner), Apache reverse proxy (Clipper SLES), Google Apps Script.

**Spec:** `docs/superpowers/specs/2026-05-08-sheet-change-push-design.md`

---

## File Structure

**Create:**

- `src/lib/sse/hub.ts` — module-level `Set<Subscriber>` with `subscribe()` and `broadcastChanged()` (leading + trailing-edge debounce).
- `src/lib/sse/hub.test.ts` — unit tests for hub behaviour.
- `src/lib/sse/webhook.ts` — pure logic: `verifyHmac(body, sig, secret)` and `processSheetChange({invalidate, broadcast})` (DI for testability; asserts invalidate-before-broadcast ordering).
- `src/lib/sse/webhook.test.ts` — unit tests for HMAC and ordering.
- `src/app/api/sheet-changed/route.ts` — thin POST handler: read body + sig, call `verifyHmac`, call `processSheetChange` with real deps, return 200/403.
- `src/app/api/changes/route.ts` — auth-gated GET, returns `text/event-stream` ReadableStream wired to the hub with 25s heartbeat.
- `src/components/sheet-change-listener.tsx` — client component, opens `EventSource("/api/changes")`, debounces `router.refresh()`.
- `src/app/dashboard/layout.tsx` — new layout that mounts `<SheetChangeListener />` once for both EPO and Management dashboards.
- `scripts/deploy/onSheetEdit.gs` — Apps Script source (kept with other deploy artifacts).
- `scripts/deploy/SHEET_CHANGE_PUSH.md` — deploy doc: Apache `<Location>` snippet, Apps Script trigger setup, secret generation.

**Modify:**

- `src/app/dashboard/actions.ts` — add `broadcastChanged()` import and one call after each of the six `invalidateLiveSourcesCache()` sites (lines 77, 113, 150, 197, 248, 280) so admin edits in the app also push to other open tabs.
- `.env.local.example` — add `SHEET_WEBHOOK_SECRET=...` with generation instructions matching the existing `SNAPSHOT_CRON_TOKEN` style.

---

## Task 1: SSE hub — subscribe / broadcast / unsubscribe (no debounce yet)

**Files:**
- Create: `src/lib/sse/hub.ts`
- Test: `src/lib/sse/hub.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/sse/hub.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import {
  _resetForTest,
  _statsForTest,
  broadcastChanged,
  subscribe,
} from "./hub";

afterEach(() => {
  _resetForTest();
});

type Received = { event: string; data: string };

function makeRecorder() {
  const received: Received[] = [];
  return {
    subscriber: {
      id: "test",
      send: (event: string, data: string) => {
        received.push({ event, data });
      },
      close: () => {},
    },
    received,
  };
}

describe("hub — subscribe / broadcast", () => {
  test("subscribed receives broadcastChanged event", () => {
    const r = makeRecorder();
    subscribe(r.subscriber);
    broadcastChanged();
    // Allow the leading-edge fire to settle synchronously.
    expect(r.received.length).toBeGreaterThanOrEqual(1);
    expect(r.received[0]?.event).toBe("changed");
  });

  test("multiple subscribers all receive", () => {
    const a = makeRecorder();
    const b = makeRecorder();
    subscribe(a.subscriber);
    subscribe(b.subscriber);
    broadcastChanged();
    expect(a.received.length).toBeGreaterThanOrEqual(1);
    expect(b.received.length).toBeGreaterThanOrEqual(1);
  });

  test("unsubscribed does not receive", () => {
    const r = makeRecorder();
    const unsub = subscribe(r.subscriber);
    unsub();
    broadcastChanged();
    expect(r.received.length).toBe(0);
  });

  test("_statsForTest reports active count", () => {
    expect(_statsForTest().count).toBe(0);
    const a = makeRecorder();
    const unsubA = subscribe(a.subscriber);
    expect(_statsForTest().count).toBe(1);
    const b = makeRecorder();
    subscribe(b.subscriber);
    expect(_statsForTest().count).toBe(2);
    unsubA();
    expect(_statsForTest().count).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/sse/hub.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/sse/hub.ts
export type Subscriber = {
  id: string;
  send: (event: string, data: string) => void;
  close: () => void;
};

const subscribers = new Set<Subscriber>();

export function subscribe(s: Subscriber): () => void {
  subscribers.add(s);
  return () => {
    subscribers.delete(s);
  };
}

export function broadcastChanged(): void {
  for (const s of subscribers) {
    s.send("changed", "");
  }
}

export function _statsForTest(): { count: number } {
  return { count: subscribers.size };
}

export function _resetForTest(): void {
  subscribers.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/sse/hub.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sse/hub.ts src/lib/sse/hub.test.ts
git commit -m "feat(sse): add in-process broadcast hub (basic subscribe/broadcast)"
```

---

## Task 2: SSE hub — leading + trailing-edge debounce

**Files:**
- Modify: `src/lib/sse/hub.ts`
- Modify: `src/lib/sse/hub.test.ts`

The first burst-call should fire immediately (leading edge) so user feedback is fast; subsequent calls within `DEBOUNCE_MS` collapse into a single trailing-edge fire after the window expires. Net: 1 fire for a single edit, exactly 2 fires for any size burst.

- [ ] **Step 1: Add the failing debounce tests**

Append to `src/lib/sse/hub.test.ts`:

```ts
describe("hub — debounce", () => {
  test("leading edge fires immediately on first call", () => {
    const r = makeRecorder();
    subscribe(r.subscriber);
    broadcastChanged();
    expect(r.received.length).toBe(1);
  });

  test("burst of 30 within window produces exactly 2 broadcasts (leading + trailing)", async () => {
    const r = makeRecorder();
    subscribe(r.subscriber);
    for (let i = 0; i < 30; i++) {
      broadcastChanged();
    }
    expect(r.received.length).toBe(1); // only leading edge has fired so far
    await new Promise((res) => setTimeout(res, 500)); // > DEBOUNCE_MS (400)
    expect(r.received.length).toBe(2);
  });

  test("single call after window → only one broadcast (no spurious trailing)", async () => {
    const r = makeRecorder();
    subscribe(r.subscriber);
    broadcastChanged();
    await new Promise((res) => setTimeout(res, 500));
    expect(r.received.length).toBe(1);
  });

  test("two calls separated by > DEBOUNCE_MS produce 2 broadcasts (no debounce)", async () => {
    const r = makeRecorder();
    subscribe(r.subscriber);
    broadcastChanged();
    await new Promise((res) => setTimeout(res, 500));
    broadcastChanged();
    expect(r.received.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify the debounce tests fail**

Run: `bun test src/lib/sse/hub.test.ts`
Expected: the basic tests pass; the new "burst of 30" test fails (currently fires 30 times, not 1).

- [ ] **Step 3: Add debounce to the hub**

Replace the body of `src/lib/sse/hub.ts` with:

```ts
export type Subscriber = {
  id: string;
  send: (event: string, data: string) => void;
  close: () => void;
};

export const DEBOUNCE_MS = 400;

const subscribers = new Set<Subscriber>();
let lastFireAt = 0;
let trailingTimer: ReturnType<typeof setTimeout> | null = null;

export function subscribe(s: Subscriber): () => void {
  subscribers.add(s);
  return () => {
    subscribers.delete(s);
  };
}

function fire(): void {
  for (const s of subscribers) {
    s.send("changed", "");
  }
  lastFireAt = Date.now();
}

export function broadcastChanged(): void {
  const now = Date.now();
  const elapsed = now - lastFireAt;

  if (elapsed >= DEBOUNCE_MS) {
    // Leading edge: fire immediately, open the window.
    fire();
    return;
  }

  // Inside the window: schedule (or reschedule) one trailing fire.
  if (trailingTimer) return;
  trailingTimer = setTimeout(() => {
    trailingTimer = null;
    fire();
  }, DEBOUNCE_MS - elapsed);
}

export function _statsForTest(): { count: number } {
  return { count: subscribers.size };
}

export function _resetForTest(): void {
  subscribers.clear();
  lastFireAt = 0;
  if (trailingTimer) {
    clearTimeout(trailingTimer);
    trailingTimer = null;
  }
}
```

- [ ] **Step 4: Run tests to verify they all pass**

Run: `bun test src/lib/sse/hub.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sse/hub.ts src/lib/sse/hub.test.ts
git commit -m "feat(sse): debounce broadcastChanged (leading + trailing edge, 400ms)"
```

---

## Task 3: HMAC verify utility

**Files:**
- Create: `src/lib/sse/webhook.ts`
- Test: `src/lib/sse/webhook.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/sse/webhook.test.ts
import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { verifyHmac } from "./webhook";

const SECRET = "test-secret-12345";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

describe("verifyHmac", () => {
  test("accepts valid signature", () => {
    const body = "hello";
    expect(verifyHmac(body, sign(body), SECRET)).toBe(true);
  });

  test("accepts valid signature for empty body", () => {
    expect(verifyHmac("", sign(""), SECRET)).toBe(true);
  });

  test("rejects wrong signature", () => {
    expect(verifyHmac("hello", sign("world"), SECRET)).toBe(false);
  });

  test("rejects null signature", () => {
    expect(verifyHmac("hello", null, SECRET)).toBe(false);
  });

  test("rejects empty signature", () => {
    expect(verifyHmac("hello", "", SECRET)).toBe(false);
  });

  test("rejects missing secret (env unset)", () => {
    expect(verifyHmac("hello", sign("hello"), undefined)).toBe(false);
  });

  test("rejects malformed hex signature without throwing", () => {
    expect(verifyHmac("hello", "not-hex-zzz", SECRET)).toBe(false);
  });

  test("rejects signature of wrong length without throwing", () => {
    expect(verifyHmac("hello", "abcd", SECRET)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/sse/webhook.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/sse/webhook.ts
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 hex-digest verify. Constant-time. Safe for malformed input —
 * never throws; returns false instead.
 */
export function verifyHmac(
  body: string,
  signatureHex: string | null,
  secret: string | undefined
): boolean {
  if (!signatureHex || !secret) return false;

  const expectedHex = createHmac("sha256", secret).update(body).digest("hex");
  if (signatureHex.length !== expectedHex.length) return false;

  let received: Buffer;
  try {
    received = Buffer.from(signatureHex, "hex");
  } catch {
    return false;
  }
  // Buffer.from with non-hex chars produces a shorter buffer rather than
  // throwing — guard against that explicitly.
  if (received.length * 2 !== expectedHex.length) return false;

  const expected = Buffer.from(expectedHex, "hex");
  return timingSafeEqual(received, expected);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/sse/webhook.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sse/webhook.ts src/lib/sse/webhook.test.ts
git commit -m "feat(sse): add HMAC-SHA256 verify utility"
```

---

## Task 4: `processSheetChange` orchestrator (invalidate-then-broadcast ordering)

**Files:**
- Modify: `src/lib/sse/webhook.ts`
- Modify: `src/lib/sse/webhook.test.ts`

The webhook must invalidate the cache **before** broadcasting, otherwise client `router.refresh()` calls can race ahead of the invalidation and re-render against still-cached stale data. We use dependency injection so the test can spy on call order without coupling to the live cache singleton.

- [ ] **Step 1: Add the failing ordering test**

Append to `src/lib/sse/webhook.test.ts`:

```ts
import { processSheetChange } from "./webhook";

describe("processSheetChange — invariants", () => {
  test("calls invalidate before broadcast (order-sensitive)", () => {
    const calls: string[] = [];
    processSheetChange({
      invalidate: () => calls.push("invalidate"),
      broadcast: () => calls.push("broadcast"),
    });
    expect(calls).toEqual(["invalidate", "broadcast"]);
  });

  test("calls each dependency exactly once", () => {
    let invalidateCalls = 0;
    let broadcastCalls = 0;
    processSheetChange({
      invalidate: () => invalidateCalls++,
      broadcast: () => broadcastCalls++,
    });
    expect(invalidateCalls).toBe(1);
    expect(broadcastCalls).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/sse/webhook.test.ts`
Expected: FAIL — `processSheetChange` not exported.

- [ ] **Step 3: Add the orchestrator**

Append to `src/lib/sse/webhook.ts`:

```ts
export function processSheetChange(deps: {
  invalidate: () => void;
  broadcast: () => void;
}): void {
  // Order matters: invalidating after the broadcast lets a racing
  // router.refresh() re-render against the still-cached stale value.
  deps.invalidate();
  deps.broadcast();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/sse/webhook.test.ts`
Expected: 10 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sse/webhook.ts src/lib/sse/webhook.test.ts
git commit -m "feat(sse): add processSheetChange orchestrator with invalidate-first ordering"
```

---

## Task 5: `/api/sheet-changed` route (thin POST handler)

**Files:**
- Create: `src/app/api/sheet-changed/route.ts`

This route is a thin wrapper — all logic is in `lib/sse/webhook.ts` and exercised by unit tests. Smoke-test by curl in Step 4.

- [ ] **Step 1: Write the route**

```ts
// src/app/api/sheet-changed/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { invalidateLiveSourcesCache } from "@/lib/snapshot/live-cache";
import { broadcastChanged } from "@/lib/sse/hub";
import { processSheetChange, verifyHmac } from "@/lib/sse/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const sig = req.headers.get("x-signature");
  const body = await req.text();
  if (!verifyHmac(body, sig, process.env.SHEET_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  processSheetChange({
    invalidate: invalidateLiveSourcesCache,
    broadcast: broadcastChanged,
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Add `SHEET_WEBHOOK_SECRET` to `.env.local`**

Edit `.env.local` (not committed) and append:

```
SHEET_WEBHOOK_SECRET=local-dev-secret-32-chars-or-more
```

- [ ] **Step 3: Smoke test with `bun run dev`**

Tell AJ to start `bun run dev`. In another terminal:

```bash
# Bad signature → 403
curl -i -X POST http://localhost:3000/api/sheet-changed \
  -H "x-signature: deadbeef" \
  -d ''
# Expect: HTTP/1.1 403 Forbidden, body {"error":"forbidden"}

# Valid signature → 200
SECRET=local-dev-secret-32-chars-or-more
SIG=$(printf '' | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')
curl -i -X POST http://localhost:3000/api/sheet-changed \
  -H "x-signature: $SIG" \
  -d ''
# Expect: HTTP/1.1 200 OK, body {"ok":true}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/sheet-changed/route.ts
git commit -m "feat(api): add /api/sheet-changed webhook (HMAC, invalidate, broadcast)"
```

---

## Task 6: `/api/changes` SSE endpoint

**Files:**
- Create: `src/app/api/changes/route.ts`

Long-lived `text/event-stream` response; auth-gated by Supabase session; 25s heartbeat; carefully orders unsubscribe-before-close on cancel.

- [ ] **Step 1: Write the route**

```ts
// src/app/api/changes/route.ts
import { createClient } from "@/lib/supabase/server";
import { subscribe } from "@/lib/sse/hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

export async function GET(): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        try {
          controller.enqueue(chunk);
        } catch {
          // Stream closed (client disconnected) — ignore.
        }
      };

      unsub = subscribe({
        id: crypto.randomUUID(),
        send: (event, data) =>
          safeEnqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`)),
        close: () => {
          try {
            controller.close();
          } catch {
            // Already closed — ignore.
          }
        },
      });

      // Initial comment opens the stream for browsers that buffer headers.
      safeEnqueue(encoder.encode(`: open\n\n`));

      heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(`: ping\n\n`));
      }, HEARTBEAT_MS);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (unsub) unsub();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Apache needs this disabled at the proxy level too — see deploy doc.
      "X-Accel-Buffering": "no",
    },
  });
}
```

- [ ] **Step 2: Smoke test (unauthenticated)**

```bash
curl -i http://localhost:3000/api/changes
# Expect: HTTP/1.1 401 Unauthorized, body "unauthorized"
```

- [ ] **Step 3: Smoke test (authenticated, with browser)**

Tell AJ to:
1. Sign in to `http://localhost:3000` in a browser tab.
2. Open DevTools → Network → filter "changes".
3. Visit `http://localhost:3000/api/changes` directly.
4. Confirm the response is pending/open with `Content-Type: text/event-stream`.
5. In another terminal, fire the valid-signature curl from Task 5.
6. Confirm `event: changed` lands in the SSE response within ~1s.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/changes/route.ts
git commit -m "feat(api): add /api/changes SSE endpoint (auth-gated, hub-subscribed)"
```

---

## Task 7: `<SheetChangeListener />` client component

**Files:**
- Create: `src/components/sheet-change-listener.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/sheet-change-listener.tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const REFRESH_LOCKOUT_MS = 500;

export function SheetChangeListener() {
  const router = useRouter();

  useEffect(() => {
    let refreshing = false;
    let pending = false;

    const runRefresh = () => {
      if (refreshing) {
        pending = true;
        return;
      }
      refreshing = true;
      router.refresh();
      window.setTimeout(() => {
        refreshing = false;
        if (pending) {
          pending = false;
          runRefresh();
        }
      }, REFRESH_LOCKOUT_MS);
    };

    const es = new EventSource("/api/changes");
    es.addEventListener("changed", runRefresh);
    // Browser handles reconnect with backoff; nothing to do on error.

    return () => {
      es.close();
    };
  }, [router]);

  return null;
}
```

- [ ] **Step 2: Commit (listener not yet mounted; safe to land)**

```bash
git add src/components/sheet-change-listener.tsx
git commit -m "feat(client): add SheetChangeListener (EventSource → debounced router.refresh)"
```

---

## Task 8: Mount the listener in a new dashboard layout

**Files:**
- Create: `src/app/dashboard/layout.tsx`

There is currently no `dashboard/layout.tsx` (verified at plan time). Adding one with `{children}` is transparent — `dashboard/page.tsx` keeps rendering as before, but every dashboard URL now mounts `<SheetChangeListener />` once.

- [ ] **Step 1: Write the layout**

```tsx
// src/app/dashboard/layout.tsx
import type { ReactNode } from "react";
import { SheetChangeListener } from "@/components/sheet-change-listener";

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      <SheetChangeListener />
      {children}
    </>
  );
}
```

- [ ] **Step 2: Smoke test the full client→server→client loop**

Tell AJ to:
1. Run `bun run dev`.
2. Sign in and open `/dashboard` in two browser tabs.
3. DevTools → Network in both tabs should show a pending `changes` request with `Content-Type: text/event-stream`.
4. In a terminal, send a valid-signature curl to `/api/sheet-changed` (see Task 5 step 3).
5. Both tabs should refresh within ~1s (a router.refresh ticks; visible as a new RSC fetch in the Network tab).

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/layout.tsx
git commit -m "feat(dashboard): mount SheetChangeListener via new dashboard layout"
```

---

## Task 9: Wire `broadcastChanged()` into existing server actions

**Files:**
- Modify: `src/app/dashboard/actions.ts`

The six existing `invalidateLiveSourcesCache()` call sites already invalidate on admin edits made inside the app. Adding `broadcastChanged()` after each makes those edits propagate to other open tabs immediately, with no Sheets round-trip needed.

- [ ] **Step 1: Add the import**

In `src/app/dashboard/actions.ts`, add to the existing imports near the top:

```ts
import { broadcastChanged } from "@/lib/sse/hub";
```

- [ ] **Step 2: Add `broadcastChanged()` after each `invalidateLiveSourcesCache()`**

Six sites. After each existing line `invalidateLiveSourcesCache();`, add `broadcastChanged();` on the next line. The lines are at 77, 113, 150, 197, 248, 280 (from the spec). Verify with:

```bash
grep -n "invalidateLiveSourcesCache" src/app/dashboard/actions.ts
```

After editing, verify each pair shows up adjacent:

```bash
grep -n -A 1 "invalidateLiveSourcesCache" src/app/dashboard/actions.ts
```

Expected: every match line is immediately followed by a `broadcastChanged();` line.

- [ ] **Step 3: Run the existing test suite to verify nothing breaks**

Run: `bun test`
Expected: all existing tests still pass; new hub + webhook tests pass.

- [ ] **Step 4: Smoke test**

Tell AJ to:
1. Open `/dashboard` in two tabs as the same user.
2. In tab A, perform an action that triggers one of the server actions (e.g. assign an EPO).
3. Tab B should refresh within ~1s without any Sheet edit.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/actions.ts
git commit -m "feat(dashboard): broadcast SSE changed after server-action cache invalidations"
```

---

## Task 10: Apps Script source + `.env.local.example` + deploy doc

**Files:**
- Create: `scripts/deploy/onSheetEdit.gs`
- Create: `scripts/deploy/SHEET_CHANGE_PUSH.md`
- Modify: `.env.local.example`

- [ ] **Step 1: Add the Apps Script source**

```js
// scripts/deploy/onSheetEdit.gs
//
// Bound script for the master schedule sheet. Install as an installable
// "On edit" trigger so it can call UrlFetchApp (simple onEdit cannot).
//
// Setup:
//   1. Open the master sheet → Extensions → Apps Script.
//   2. Paste this file's contents into Code.gs.
//   3. Project Settings → Script Properties → add:
//        WEBHOOK_SECRET = <same value as SHEET_WEBHOOK_SECRET on server>
//   4. Triggers (clock icon) → Add Trigger:
//        Function:     onSheetEdit
//        Event source: From spreadsheet
//        Event type:   On edit
//   5. Save → grant UrlFetchApp scope when prompted.

const WEBHOOK_URL = 'https://clipper.speedero.com/SecApp/api/sheet-changed';

function getSecret_() {
  return PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
}

function onSheetEdit(_e) {
  const secret = getSecret_();
  if (!secret) {
    console.warn('WEBHOOK_SECRET not set in Script Properties; skipping.');
    return;
  }

  const body = '';
  const sigBytes = Utilities.computeHmacSha256Signature(body, secret);
  const sig = sigBytes
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); })
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

- [ ] **Step 2: Add the deploy doc**

```markdown
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
```

- [ ] **Step 3: Add to `.env.local.example`**

Append to `.env.local.example`:

```
# Shared secret for Apps Script → /api/sheet-changed webhook.
# Same value goes in the bound Apps Script's Script Properties as WEBHOOK_SECRET.
# Generate with:
#   openssl rand -hex 32
# Production value lives in /data/SecApp/shared/.env.production on Clipper.
SHEET_WEBHOOK_SECRET=replace-with-32-hex-chars
```

- [ ] **Step 4: Commit**

```bash
git add scripts/deploy/onSheetEdit.gs scripts/deploy/SHEET_CHANGE_PUSH.md .env.local.example
git commit -m "docs(deploy): Apps Script + Apache config for sheet-change push"
```

---

## Task 11: End-to-end production verification

**Files:** none (operational).

This is a manual gate — AJ does it after the previous tasks land on Clipper.

- [ ] **Step 1: Generate the production secret**

`openssl rand -hex 32` → save to a password manager once.

- [ ] **Step 2: Set `SHEET_WEBHOOK_SECRET` on Clipper**

Per `scripts/deploy/SHEET_CHANGE_PUSH.md` step 2.

- [ ] **Step 3: Apply the Apache `<Location>` block + reload**

Per `scripts/deploy/SHEET_CHANGE_PUSH.md` step 3.

- [ ] **Step 4: Install the bound Apps Script + trigger + Script Property**

Per `scripts/deploy/SHEET_CHANGE_PUSH.md` step 4.

- [ ] **Step 5: End-to-end test against production**

1. Open `https://clipper.speedero.com/SecApp/dashboard` in two browser tabs (different users if possible).
2. In Apps Script editor, watch Executions tab.
3. Edit a cell on the master sheet.
4. Confirm an `onSheetEdit` execution shows up within ~2s.
5. Confirm both dashboards refresh within ~3s.
6. Open DevTools Network → filter `changes` → confirm the SSE connection is open with `Content-Type: text/event-stream`.

If the connection drops repeatedly (every few seconds), Apache buffering is
still active — re-check the `<Location>` block.

---

## Self-Review

**Spec coverage:**
- Apps Script `onEdit` trigger → Task 10 (`scripts/deploy/onSheetEdit.gs`).
- HMAC-signed webhook → Tasks 3, 4, 5.
- `invalidateLiveSourcesCache()` before broadcast → Task 4 (ordering test).
- In-process SSE hub with debounce → Tasks 1, 2.
- Auth-gated `/api/changes` SSE endpoint → Task 6.
- 25s heartbeat → Task 6.
- `EventSource` client with debounced `router.refresh()` → Task 7.
- Mount in dashboard layout (creating it if needed) → Task 8.
- `broadcastChanged()` from server actions → Task 9.
- Apache `<Location>` config + module check → Task 10 deploy doc.
- `SHEET_WEBHOOK_SECRET` in env.example → Task 10.
- Production smoke → Task 11.

**Out of scope (per spec, intentionally not in plan):**
- Multi-instance broker swap (Supabase Realtime).
- `AutoRefresh` on `/admin/users`.
- Granular row-level events.
- Apps Script `onChange` (structural row edits).
- API-driven Sheet writes calling the webhook directly.

**Type / API consistency:**
- `Subscriber` shape (`id`, `send`, `close`) is identical in `hub.ts` and `/api/changes/route.ts`.
- `verifyHmac(body, sig, secret)` signature matches between `webhook.ts` and the route handler.
- `processSheetChange({invalidate, broadcast})` deps shape matches at definition (Task 4) and call site (Task 5).
- `broadcastChanged()` is the single export used by webhook (Task 5) and server actions (Task 9).
