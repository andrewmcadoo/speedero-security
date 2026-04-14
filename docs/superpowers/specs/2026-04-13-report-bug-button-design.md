# Report Bug Button — Design

**Date:** 2026-04-13
**Status:** Approved, ready for implementation planning

## Goal

Let any authenticated user file a bug report from inside the app. Reports land as GitHub Issues in `andrewmcadoo/speedero-security` so they join the existing workflow. Users never see GitHub directly — they fill a one-field form; the server posts the issue on their behalf with a service token.

## Scope

**In scope**
- Button + modal component, rendered in all three existing headers
- `POST /api/bugs` server route that creates a GitHub Issue
- Auto-capture of user email, page URL, timestamp, user agent
- Fine-grained PAT stored as `GITHUB_BUGS_TOKEN`
- Basic rate limit (5/user/hour, in-memory)
- Unit tests for pure helpers; manual end-to-end smoke test

**Out of scope (explicitly)**
- Screenshot attachments
- Structured fields (severity, steps-to-reproduce, etc.) — single textarea only
- Exposing the created issue URL back to the user
- Admin dashboard for reviewing reports (GitHub itself is the review surface)
- Persistent rate limit (DB-backed) — in-memory is sufficient for the user count

## User Experience

1. User sees **Report Bug** button in the top-right of the header, next to **Sign Out**, on every authenticated page.
2. Click → modal opens with a single textarea labelled *"What went wrong?"*, plus **Submit** and **Cancel** buttons.
3. Submit → button shows loading state → on success, modal closes and a toast reads *"Bug report sent — thanks!"*.
4. On error, an inline error message appears in the modal and the textarea contents are preserved so the user can retry.

The user never sees the GitHub issue URL or number. This keeps GitHub invisible, matching the decision that most users don't have GitHub accounts.

## Architecture

### Component: `src/components/report-bug-button.tsx`
- Client component.
- Uses existing UI primitives / styling conventions already used by `SignOutButton` and other modals in the app (`add-user-form`, `edit-user-modal`).
- Owns modal state, textarea state, loading state, error state.
- On submit, `fetch('/api/bugs', { method: 'POST', body: JSON.stringify({ description }) })`.
- Imported alongside `<SignOutButton />` in:
  - `src/app/dashboard/management-dashboard.tsx`
  - `src/app/dashboard/epo-dashboard.tsx`
  - `src/app/admin/users/page.tsx`

### Server route: `src/app/api/bugs/route.ts`
- `POST` handler only.
- Steps:
  1. Read Supabase session via the existing server client. Reject with 401 if unauthenticated.
  2. Validate body: `description` is a non-empty string, max length 5000 chars.
  3. Apply rate limit (see below). On exceed, return 429.
  4. Build issue title and body (see *Issue Format*).
  5. `POST` to `https://api.github.com/repos/andrewmcadoo/speedero-security/issues` with `Authorization: Bearer ${GITHUB_BUGS_TOKEN}` and `Accept: application/vnd.github+json`.
  6. On GitHub 2xx, return `{ ok: true }`. On non-2xx, log the response body and return `{ ok: false, error: 'Could not file the report' }` with status 502.
- If `GITHUB_BUGS_TOKEN` is missing at invocation time, log a clear error and return 500.

### Issue format
- **Title:** first 60 characters of the description, trimmed. If the description is shorter than 10 chars, fall back to `Bug report from {email}`.
- **Body:**
  ```
  Reported by: {email}
  URL: {referer}
  Time: {ISO timestamp}
  User agent: {ua}

  ---

  {description}
  ```
- **Labels:** `["bug", "user-report"]` (the route must tolerate labels not yet existing in the repo — GitHub will create them if the token has permission, otherwise the request can succeed without labels; decide during implementation whether to pre-create them in the repo).

### Rate limit
- In-memory `Map<email, timestamps[]>`.
- On each request, drop timestamps older than 1 hour, then check length; reject if >=5.
- Resets on server restart — acceptable because this is a courtesy cap, not a security boundary.
- Extracted into a small pure helper so it can be unit-tested.

### Config
- New env var: `GITHUB_BUGS_TOKEN`
  - Fine-grained personal access token
  - Scope: **only** `andrewmcadoo/speedero-security`, **Issues: Read and write**
  - Stored in `.env.local` for local dev and in Vercel project settings for preview + production
- No client-side env var needed.

## Testing

**Unit tests**
- Issue-body formatter: given description + metadata, returns the expected title and body string. Covers the short-description fallback case.
- Rate limiter: first 5 calls pass within an hour; 6th fails; after an hour the window resets.

**Manual smoke test (before merging)**
1. `bun run dev`
2. Log in as a test user
3. Click **Report Bug**, submit a test description
4. Confirm toast appears
5. Confirm issue lands in GitHub with correct title, body metadata, and labels
6. Submit 5 more in quick succession, confirm the 6th shows rate-limit error

## Open questions

None — all design questions resolved in brainstorming.

## Follow-ups (not blockers)

- If reports pile up, consider a small admin view that lists recent reports without leaving the app.
- If users ask for screenshots, revisit — likely means uploading via the GitHub API's image-attachment flow or to Supabase storage and linking.
