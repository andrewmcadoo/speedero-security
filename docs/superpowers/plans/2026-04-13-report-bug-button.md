# Report Bug Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authenticated users file a bug report via a header button that creates a GitHub Issue server-side, so users never see GitHub.

**Architecture:** A client component `<ReportBugButton />` renders a header button + modal with a single textarea. On submit it POSTs to a new `/api/bugs` route. The route validates the session (Supabase), rate-limits per user (in-memory), and calls the GitHub REST API `POST /repos/andrewmcadoo/speedero-security/issues` using a fine-grained PAT (`GITHUB_BUGS_TOKEN`). Pure helpers (issue-body formatter, rate limiter) live in `src/lib/bugs/` and are unit-tested with `bun:test`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Supabase SSR, `bun:test`, GitHub REST API v2022-11-28.

**Spec:** `docs/superpowers/specs/2026-04-13-report-bug-button-design.md`

---

## File Structure

**New files**
- `src/lib/bugs/format-issue.ts` — pure `formatIssue({ description, email, url, timestamp, userAgent })` returning `{ title, body, labels }`
- `src/lib/bugs/format-issue.test.ts` — unit tests for the formatter
- `src/lib/bugs/rate-limit.ts` — pure `createRateLimiter({ max, windowMs, now })` returning `{ check(key): { allowed: boolean; retryAfterMs?: number } }`
- `src/lib/bugs/rate-limit.test.ts` — unit tests for the limiter
- `src/app/api/bugs/route.ts` — `POST` handler
- `src/components/report-bug-button.tsx` — client component (button + modal)

**Modified files**
- `src/app/dashboard/management-dashboard.tsx` — import + render `<ReportBugButton />` next to `<SignOutButton />`
- `src/app/dashboard/epo-dashboard.tsx` — same
- `src/app/admin/users/page.tsx` — render `<ReportBugButton />` in the header (this page currently has only a "Back to Dashboard" link, no SignOutButton — add the button alongside the link)
- `.env.local` — add `GITHUB_BUGS_TOKEN=...` (manual step noted in Task 7)

---

## Task 1: Issue formatter — helper + tests

**Files:**
- Create: `src/lib/bugs/format-issue.ts`
- Test: `src/lib/bugs/format-issue.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/bugs/format-issue.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { formatIssue } from "./format-issue";

const META = {
  email: "aj@example.com",
  url: "https://secapp.example.com/dashboard",
  timestamp: "2026-04-13T14:23:00.000Z",
  userAgent: "Mozilla/5.0 (Test)",
};

describe("formatIssue", () => {
  test("uses first 60 chars of description as title", () => {
    const description = "The EPO dropdown does not save when I click submit quickly";
    const issue = formatIssue({ description, ...META });
    expect(issue.title).toBe("The EPO dropdown does not save when I click submit quickly");
  });

  test("truncates long descriptions at 60 chars without trailing whitespace", () => {
    const description = "x".repeat(70);
    const issue = formatIssue({ description, ...META });
    expect(issue.title).toBe("x".repeat(60));
  });

  test("falls back when description is shorter than 10 chars", () => {
    const issue = formatIssue({ description: "typo", ...META });
    expect(issue.title).toBe("Bug report from aj@example.com");
  });

  test("body contains metadata block, separator, and full description", () => {
    const description = "Detailed repro steps here";
    const issue = formatIssue({ description, ...META });
    expect(issue.body).toBe(
      [
        "Reported by: aj@example.com",
        "URL: https://secapp.example.com/dashboard",
        "Time: 2026-04-13T14:23:00.000Z",
        "User agent: Mozilla/5.0 (Test)",
        "",
        "---",
        "",
        "Detailed repro steps here",
      ].join("\n")
    );
  });

  test("applies bug and user-report labels", () => {
    const issue = formatIssue({ description: "something broke", ...META });
    expect(issue.labels).toEqual(["bug", "user-report"]);
  });

  test("trims whitespace when extracting title", () => {
    const issue = formatIssue({
      description: "   leading spaces in description text here and more content",
      ...META,
    });
    expect(issue.title.startsWith(" ")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/bugs/format-issue.test.ts`
Expected: FAIL — `Cannot find module './format-issue'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/bugs/format-issue.ts`:

```ts
export type FormatIssueInput = {
  description: string;
  email: string;
  url: string;
  timestamp: string;
  userAgent: string;
};

export type FormattedIssue = {
  title: string;
  body: string;
  labels: string[];
};

const TITLE_MAX = 60;
const MIN_DESCRIPTION_FOR_TITLE = 10;

export function formatIssue(input: FormatIssueInput): FormattedIssue {
  const trimmed = input.description.trim();

  const title =
    trimmed.length < MIN_DESCRIPTION_FOR_TITLE
      ? `Bug report from ${input.email}`
      : trimmed.slice(0, TITLE_MAX);

  const body = [
    `Reported by: ${input.email}`,
    `URL: ${input.url}`,
    `Time: ${input.timestamp}`,
    `User agent: ${input.userAgent}`,
    "",
    "---",
    "",
    input.description,
  ].join("\n");

  return {
    title,
    body,
    labels: ["bug", "user-report"],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/bugs/format-issue.test.ts`
Expected: PASS — 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bugs/format-issue.ts src/lib/bugs/format-issue.test.ts
git commit -m "feat(bugs): add GitHub issue formatter with tests"
```

---

## Task 2: Rate limiter — helper + tests

**Files:**
- Create: `src/lib/bugs/rate-limit.ts`
- Test: `src/lib/bugs/rate-limit.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/bugs/rate-limit.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  test("allows up to max calls within window", () => {
    let current = 0;
    const limiter = createRateLimiter({ max: 5, windowMs: 3600_000, now: () => current });
    for (let i = 0; i < 5; i++) {
      expect(limiter.check("aj@example.com").allowed).toBe(true);
    }
  });

  test("rejects the max+1 call within window", () => {
    let current = 0;
    const limiter = createRateLimiter({ max: 5, windowMs: 3600_000, now: () => current });
    for (let i = 0; i < 5; i++) limiter.check("aj@example.com");
    const result = limiter.check("aj@example.com");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  test("resets after window elapses", () => {
    let current = 0;
    const limiter = createRateLimiter({ max: 5, windowMs: 3600_000, now: () => current });
    for (let i = 0; i < 5; i++) limiter.check("aj@example.com");
    current = 3600_001;
    expect(limiter.check("aj@example.com").allowed).toBe(true);
  });

  test("tracks keys independently", () => {
    let current = 0;
    const limiter = createRateLimiter({ max: 5, windowMs: 3600_000, now: () => current });
    for (let i = 0; i < 5; i++) limiter.check("aj@example.com");
    expect(limiter.check("other@example.com").allowed).toBe(true);
  });

  test("retryAfterMs reflects oldest-in-window timestamp", () => {
    let current = 0;
    const limiter = createRateLimiter({ max: 2, windowMs: 1000, now: () => current });
    limiter.check("aj@example.com"); // t=0
    current = 400;
    limiter.check("aj@example.com"); // t=400
    current = 500;
    const result = limiter.check("aj@example.com");
    expect(result.allowed).toBe(false);
    // oldest timestamp is 0, window 1000, now 500 → retry in 500ms
    expect(result.retryAfterMs).toBe(500);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/bugs/rate-limit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/bugs/rate-limit.ts`:

```ts
export type RateLimiterOptions = {
  max: number;
  windowMs: number;
  now?: () => number;
};

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

export type RateLimiter = {
  check: (key: string) => RateLimitResult;
};

export function createRateLimiter({
  max,
  windowMs,
  now = () => Date.now(),
}: RateLimiterOptions): RateLimiter {
  const hits = new Map<string, number[]>();

  return {
    check(key) {
      const current = now();
      const cutoff = current - windowMs;
      const previous = hits.get(key) ?? [];
      const recent = previous.filter((t) => t > cutoff);

      if (recent.length >= max) {
        const oldest = recent[0];
        const retryAfterMs = oldest + windowMs - current;
        hits.set(key, recent);
        return { allowed: false, retryAfterMs };
      }

      recent.push(current);
      hits.set(key, recent);
      return { allowed: true };
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/bugs/rate-limit.test.ts`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bugs/rate-limit.ts src/lib/bugs/rate-limit.test.ts
git commit -m "feat(bugs): add in-memory per-user rate limiter with tests"
```

---

## Task 3: API route — `POST /api/bugs`

**Files:**
- Create: `src/app/api/bugs/route.ts`

This route cannot be unit-tested cleanly without mocking fetch + Supabase; we rely on the already-tested helpers and a manual smoke test in Task 7. No test file for this task.

- [ ] **Step 1: Write the route**

Create `src/app/api/bugs/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { formatIssue } from "@/lib/bugs/format-issue";
import { createRateLimiter } from "@/lib/bugs/rate-limit";

const DESCRIPTION_MAX = 5000;
const REPO = "andrewmcadoo/speedero-security";
const GITHUB_API = `https://api.github.com/repos/${REPO}/issues`;

// Module-scoped so it persists across requests in the same server instance.
const limiter = createRateLimiter({ max: 5, windowMs: 60 * 60 * 1000 });

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const description =
    typeof body === "object" && body !== null && "description" in body
      ? (body as { description: unknown }).description
      : undefined;

  if (typeof description !== "string" || description.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "Description is required" },
      { status: 400 }
    );
  }

  if (description.length > DESCRIPTION_MAX) {
    return NextResponse.json(
      { ok: false, error: `Description must be ${DESCRIPTION_MAX} characters or fewer` },
      { status: 400 }
    );
  }

  const rate = limiter.check(user.email);
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many reports. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(rate.retryAfterMs / 1000).toString() },
      }
    );
  }

  const token = process.env.GITHUB_BUGS_TOKEN;
  if (!token) {
    console.error("GITHUB_BUGS_TOKEN is not set");
    return NextResponse.json(
      { ok: false, error: "Server misconfigured" },
      { status: 500 }
    );
  }

  const issue = formatIssue({
    description,
    email: user.email,
    url: request.headers.get("referer") ?? "(unknown)",
    timestamp: new Date().toISOString(),
    userAgent: request.headers.get("user-agent") ?? "(unknown)",
  });

  const githubResponse = await fetch(GITHUB_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "speedero-security-bug-reporter",
    },
    body: JSON.stringify({
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
    }),
  });

  if (!githubResponse.ok) {
    const text = await githubResponse.text().catch(() => "");
    console.error("GitHub issue creation failed", githubResponse.status, text);
    return NextResponse.json(
      { ok: false, error: "Could not file the report" },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run lint`
Expected: No errors in `src/app/api/bugs/route.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/bugs/route.ts
git commit -m "feat(bugs): add POST /api/bugs route that files GitHub issues"
```

---

## Task 4: Client component — `<ReportBugButton />`

**Files:**
- Create: `src/components/report-bug-button.tsx`

Follows the existing styling convention from `sign-out-button.tsx` (compact, gray-on-dark) and modal pattern from `add-user-form.tsx` (inline open/close state via `useState`, Tailwind gray palette). No toast library is in the project, so success state is shown as an inline "Sent — thanks!" message that auto-closes the modal after a short delay.

- [ ] **Step 1: Write the component**

Create `src/components/report-bug-button.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "success" };

export function ReportBugButton() {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    if (status.kind !== "success") return;
    const timer = setTimeout(() => {
      setOpen(false);
      setDescription("");
      setStatus({ kind: "idle" });
    }, 1500);
    return () => clearTimeout(timer);
  }, [status]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (description.trim().length === 0) return;
    setStatus({ kind: "submitting" });
    try {
      const response = await fetch("/api/bugs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !data.ok) {
        setStatus({
          kind: "error",
          message: data.error ?? "Could not send the report",
        });
        return;
      }
      setStatus({ kind: "success" });
    } catch {
      setStatus({ kind: "error", message: "Network error — try again" });
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md px-3 py-1.5 text-xs text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
      >
        Report Bug
      </button>
    );
  }

  const pending = status.kind === "submitting";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-3 rounded-lg bg-gray-800 p-4 shadow-lg"
      >
        <div>
          <h2 className="text-sm font-semibold text-gray-100">Report a bug</h2>
          <p className="text-xs text-gray-400">
            Describe what went wrong. We&apos;ll include your email and the page
            you were on.
          </p>
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          maxLength={5000}
          required
          autoFocus
          placeholder="What went wrong?"
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
        {status.kind === "error" && (
          <p className="text-xs text-red-400">{status.message}</p>
        )}
        {status.kind === "success" && (
          <p className="text-xs text-green-400">Sent — thanks!</p>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending || status.kind === "success"}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {pending ? "Sending..." : "Submit"}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setStatus({ kind: "idle" });
            }}
            className="rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors hover:text-gray-200"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run lint`
Expected: No errors in `src/components/report-bug-button.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/report-bug-button.tsx
git commit -m "feat(bugs): add ReportBugButton client component"
```

---

## Task 5: Wire into the three headers

**Files:**
- Modify: `src/app/dashboard/management-dashboard.tsx`
- Modify: `src/app/dashboard/epo-dashboard.tsx`
- Modify: `src/app/admin/users/page.tsx`

- [ ] **Step 1: Management dashboard — add import**

In `src/app/dashboard/management-dashboard.tsx`, find the line:

```tsx
import { SignOutButton } from "@/components/sign-out-button";
```

Add immediately below it:

```tsx
import { ReportBugButton } from "@/components/report-bug-button";
```

- [ ] **Step 2: Management dashboard — render the button**

In the same file, find the header action block (around line 66–74):

```tsx
        <div className="flex items-center gap-2">
          <Link
            href="/admin/users"
            className="rounded-md px-3 py-1.5 text-xs text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
          >
            Manage Users
          </Link>
          <SignOutButton />
        </div>
```

Replace with:

```tsx
        <div className="flex items-center gap-2">
          <Link
            href="/admin/users"
            className="rounded-md px-3 py-1.5 text-xs text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
          >
            Manage Users
          </Link>
          <ReportBugButton />
          <SignOutButton />
        </div>
```

- [ ] **Step 3: EPO dashboard — add import**

In `src/app/dashboard/epo-dashboard.tsx`, find:

```tsx
import { SignOutButton } from "@/components/sign-out-button";
```

Add immediately below:

```tsx
import { ReportBugButton } from "@/components/report-bug-button";
```

- [ ] **Step 4: EPO dashboard — render the button**

Find the header block (around line 68–76):

```tsx
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Schedule</h1>
          <p className="text-sm text-gray-400">
            {userName} &middot; {entries.length} assigned dates
          </p>
        </div>
        <SignOutButton />
      </header>
```

Replace the trailing `<SignOutButton />` line so two buttons sit side-by-side:

```tsx
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Schedule</h1>
          <p className="text-sm text-gray-400">
            {userName} &middot; {entries.length} assigned dates
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ReportBugButton />
          <SignOutButton />
        </div>
      </header>
```

- [ ] **Step 5: Admin users page — add import**

In `src/app/admin/users/page.tsx`, find:

```tsx
import Link from "next/link";
```

Add immediately below:

```tsx
import { ReportBugButton } from "@/components/report-bug-button";
```

- [ ] **Step 6: Admin users page — render the button in header**

Find the header block (around line 25–36):

```tsx
      <header className="mb-6">
        <Link
          href="/dashboard"
          className="mb-2 inline-block text-xs text-gray-500 transition-colors hover:text-gray-300"
        >
          ← Back to Dashboard
        </Link>
        <h1 className="text-xl font-bold">User Management</h1>
        <p className="text-sm text-gray-400">
          {users?.length ?? 0} users
        </p>
      </header>
```

Replace with (adds a flex row wrapping the title and `<ReportBugButton />` on the right):

```tsx
      <header className="mb-6">
        <Link
          href="/dashboard"
          className="mb-2 inline-block text-xs text-gray-500 transition-colors hover:text-gray-300"
        >
          ← Back to Dashboard
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">User Management</h1>
            <p className="text-sm text-gray-400">
              {users?.length ?? 0} users
            </p>
          </div>
          <ReportBugButton />
        </div>
      </header>
```

- [ ] **Step 7: Typecheck + lint**

Run: `bun run lint`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboard/management-dashboard.tsx src/app/dashboard/epo-dashboard.tsx src/app/admin/users/page.tsx
git commit -m "feat(bugs): render ReportBugButton in dashboard and admin headers"
```

---

## Task 6: Full test + build verification

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: All tests pass, including the 6 formatter tests and 5 rate-limit tests added in this plan.

- [ ] **Step 2: Run the production build**

Run: `bun run build`
Expected: Build succeeds, no type errors, the `/api/bugs` route is listed as a dynamic route.

If the build complains that `/api/bugs` is trying to be statically rendered, add `export const dynamic = "force-dynamic";` to the top of `src/app/api/bugs/route.ts` and re-run.

- [ ] **Step 3: Commit any follow-up fixes (only if needed)**

```bash
git add src/app/api/bugs/route.ts
git commit -m "fix(bugs): force dynamic rendering on bugs route"
```

Skip this step if Step 2 passed cleanly.

---

## Task 7: Manual end-to-end smoke test

This task requires AJ to run locally — do not automate.

- [ ] **Step 1: Generate a GitHub PAT**

In GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token:
- Repository access: Only select `andrewmcadoo/speedero-security`
- Repository permissions: **Issues: Read and write**
- Copy the token.

- [ ] **Step 2: Add token to local env**

Append to `.env.local` at the project root:

```
GITHUB_BUGS_TOKEN=github_pat_...
```

(Do not commit this file.)

- [ ] **Step 3: Add `bug` and `user-report` labels to the repo**

On GitHub, in Issues → Labels, ensure labels `bug` and `user-report` exist. Create them if missing (any color).

- [ ] **Step 4: Start the dev server**

Run: `bun run dev`
Expected: server listens on http://localhost:3000.

- [ ] **Step 5: Smoke test — happy path**

1. Log in as any test user.
2. Verify **Report Bug** appears in the header of: management dashboard, EPO dashboard, admin users page.
3. Click **Report Bug** on the dashboard.
4. Enter: `Test report from smoke test — please ignore.`
5. Submit.
6. Confirm the modal shows "Sent — thanks!" and closes after ~1.5s.
7. On GitHub, confirm the issue was created with:
   - Title starting with `Test report from smoke test`
   - Body containing the reporter email, URL, timestamp, user agent, then the description
   - Labels `bug` and `user-report`
8. Close the test issue on GitHub.

- [ ] **Step 6: Smoke test — rate limit**

1. Submit 5 more test reports in quick succession as the same user.
2. On the 6th submission, confirm an inline error appears in the modal (text: "Too many reports. Try again later.").
3. Close the 5 test issues on GitHub.

- [ ] **Step 7: Smoke test — unauthenticated**

1. Sign out.
2. In a new terminal, run: `curl -i -X POST http://localhost:3000/api/bugs -H 'Content-Type: application/json' -d '{"description":"no auth"}'`
3. Confirm response is HTTP 401.

- [ ] **Step 8: Add token to Vercel**

In Vercel project settings → Environment Variables, add `GITHUB_BUGS_TOKEN` for Preview and Production environments. Redeploy.

- [ ] **Step 9: Push**

```bash
git push
```

Expected: branch pushes cleanly, preview deploys, feature works on the preview URL.
