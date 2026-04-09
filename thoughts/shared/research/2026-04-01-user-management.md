---
date: 2026-04-02T01:06:42Z
researcher: aj
git_commit: (initial, no commits yet)
branch: main
repository: speedero-security
topic: "User Management System"
tags: [research, codebase, users, auth, supabase, profiles, roles]
status: complete
last_updated: 2026-04-01
last_updated_by: aj
---

# Research: User Management System

**Date**: 2026-04-02T01:06:42Z
**Researcher**: aj
**Branch**: main
**Repository**: speedero-security

## Research Question

How does user management work in the Speedero Security codebase — authentication, roles, user creation, session handling, and database-level access control?

## Summary

Speedero uses Supabase for authentication (email/password + Google OAuth) and a `profiles` table for role-based access. Two roles exist: `epo` (read-only officer view) and `management` (full admin). There is no self-registration — managers create users via the Supabase Admin API. Sessions are cookie-based via `@supabase/ssr`. Route protection happens at three layers: middleware (auth only), page/action code (role checks), and Postgres RLS policies.

## Detailed Findings

### 1. Authentication Flow

**Login page** (`src/app/login/page.tsx`) — `"use client"` component with two paths:

- **Email/password** (lines 18–41): calls `signOut({ scope: 'local' })` to clear stale sessions, then `signInWithPassword`, then `router.push("/dashboard")`
- **Google OAuth** (lines 43–63): calls `signOut({ scope: 'local' })`, then `signInWithOAuth({ provider: "google" })` with redirect to `/auth/callback`

**OAuth callback** (`src/app/auth/callback/route.ts`):
- Receives `code` query param, calls `exchangeCodeForSession(code)` server-side
- Redirects to `/dashboard` on success, `/login?error=auth` on failure

**OTP confirm** (`src/app/auth/confirm/route.ts`):
- Handles email OTP links via `verifyOtp({ token_hash, type })`
- Same redirect pattern as OAuth callback

### 2. Session Management

Three Supabase client constructors serve different contexts:

| Client | File | Auth Key | Context |
|--------|------|----------|---------|
| Browser | `src/lib/supabase/client.ts` | Anon key | `"use client"` components |
| Server | `src/lib/supabase/server.ts` | Anon key | Server Components, Route Handlers, Server Actions |
| Admin | `src/lib/supabase/admin.ts` | Service role key | Privileged operations (user creation) |

- Browser client: `createBrowserClient` from `@supabase/ssr`
- Server client: `createServerClient` with async `cookies()` (Next.js 15+). `setAll` wrapped in try/catch for Server Component contexts where cookies are read-only
- Admin client: bare `createClient` from `@supabase/supabase-js`, `autoRefreshToken: false`, `persistSession: false`
- Middleware: inline `createServerClient` using `NextRequest` cookies (can't use the shared server helper)

**Session refresh** (`src/middleware.ts:22–37`): middleware creates a Supabase client on every request, propagating updated session cookies onto both the incoming request and outgoing response.

### 3. Roles and Enforcement

**Storage**: `profiles.role` column, Postgres enum `user_role` with values `'epo'` and `'management'`. Default: `'epo'`.

**Three enforcement layers:**

1. **Middleware** (`src/middleware.ts`): Authentication only — checks `getUser()` result exists. No role checks. Public routes `/login` and `/auth/*` are exempted.

2. **Application code**:
   - Dashboard (`src/app/dashboard/page.tsx:32`): `profile.role === "management"` → `ManagementDashboard` vs `EpoDashboard`
   - Admin users page (`src/app/admin/users/page.tsx:10–13`): checks role, redirects non-management to `/dashboard`
   - `addUser` action (`src/app/admin/users/actions.ts:12–15`): returns `{ error: "Unauthorized" }` for non-management

3. **Database RLS** (migration `001_initial_schema.sql`):
   - `is_management()` SQL function (lines 68–75): checks `profiles` for `role = 'management'` at `auth.uid()`
   - Profiles: SELECT allows `id = auth.uid() OR is_management()`; INSERT allows `id = auth.uid()`; UPDATE requires `is_management()`
   - Assignments: SELECT allows `epo_id = auth.uid() OR is_management()`; INSERT/DELETE require `is_management()`
   - Date settings: SELECT allows any authenticated user; INSERT/UPDATE require `is_management()`

### 4. User Creation (No Self-Registration)

**UI**: `src/components/add-user-form.tsx` — `"use client"` form with `useActionState` binding. Collects email, password, full name, role.

**Server Action** (`src/app/admin/users/actions.ts`):

1. Auth check: fetches calling user's profile, verifies `role === "management"`
2. Input validation: email format, password min 6 chars, valid role value
3. Creates auth user: `admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name } })`
4. Upserts profile: `admin.from("profiles").upsert({ id, email, full_name, role })` — overrides the trigger's default `'epo'` with the selected role
5. Cache invalidation: `revalidatePath("/admin/users")`

**Database trigger** (`handle_new_user`, migration 001 lines 42–61, revised in 002):
- Fires `AFTER INSERT ON auth.users`
- Creates a `profiles` row with `role = 'epo'` default
- `SECURITY DEFINER`, exception-safe (logs errors, doesn't block auth insert)

**Fallback** in `getProfile` (`src/lib/supabase/queries.ts:22–32`): if the trigger failed and no profile row exists, upserts one with `role: 'epo'`. This is why migration 003 re-added the INSERT policy on profiles.

### 5. Admin Users Page

**Page** (`src/app/admin/users/page.tsx`):
- Server Component, calls `getProfile` for role check
- Queries all profiles ordered by `created_at`
- Renders user list + `AddUserForm`

### 6. Profile Queries

**`getProfile`** (`src/lib/supabase/queries.ts:4–35`):
- Gets current `auth.uid()`, queries profiles, returns profile or fallback-upserts
- Called in nearly every Server Component and Server Action

**`getAllEpos`** (`src/lib/supabase/queries.ts:62`):
- Queries `profiles WHERE role = 'epo'` for assignment dropdowns

**`getAllAssignmentsWithProfiles`** (`src/lib/supabase/queries.ts:48`):
- Joins assignments with profiles via `profiles:epo_id(id, full_name, email)`

### 7. Database Schema

**`profiles` table** (migration 001 lines 8–14):

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK, FK → `auth.users(id) ON DELETE CASCADE` |
| `email` | `text NOT NULL` | |
| `full_name` | `text NOT NULL DEFAULT ''` | |
| `role` | `user_role NOT NULL DEFAULT 'epo'` | Enum: `'epo'`, `'management'` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |

**TypeScript type** (`src/types/schedule.ts:47–53`):
```ts
interface Profile {
  id: string;
  email: string;
  fullName: string;
  role: "epo" | "management";
  createdAt: string;
}
```

## Code References

| File | Purpose |
|------|---------|
| `supabase/migrations/001_initial_schema.sql` | Schema, trigger, `is_management()`, all RLS policies |
| `supabase/migrations/002_fix_new_user_trigger.sql` | Revised `handle_new_user` function |
| `supabase/migrations/003_fix_profiles_insert_policy.sql` | Standalone INSERT policy on profiles |
| `src/lib/supabase/client.ts` | Browser Supabase client |
| `src/lib/supabase/server.ts` | Server Supabase client (async cookies) |
| `src/lib/supabase/admin.ts` | Admin client (service role key) |
| `src/lib/supabase/queries.ts` | `getProfile`, `getAllEpos`, assignment queries |
| `src/app/login/page.tsx` | Login page (email/password + Google OAuth) |
| `src/app/auth/callback/route.ts` | OAuth code exchange |
| `src/app/auth/confirm/route.ts` | OTP verification |
| `src/app/admin/users/page.tsx` | Admin user management page |
| `src/app/admin/users/actions.ts` | `addUser` Server Action |
| `src/components/add-user-form.tsx` | Add user form component |
| `src/components/sign-out-button.tsx` | Sign-out UI |
| `src/middleware.ts` | Auth guard + session refresh |
| `src/app/dashboard/page.tsx` | Role-based dashboard routing |
| `src/types/schedule.ts` | Profile TypeScript interface |

## Architecture Documentation

**Data flow — Login:**
```
LoginPage → signInWithOAuth → Google → /auth/callback → exchangeCodeForSession
→ redirect /dashboard → middleware (auth check) → DashboardPage → getProfile()
→ role check → ManagementDashboard | EpoDashboard
```

**Data flow — Create User:**
```
AddUserForm → addUser Server Action → getProfile (verify management)
→ admin.auth.admin.createUser (email_confirm: true)
→ DB trigger: INSERT profiles (role='epo')
→ admin.upsert profiles (role=selected) → revalidatePath
```

**Enforcement layers:**
```
Layer 1: Middleware — auth only (is user logged in?)
Layer 2: App code  — role checks (is user management?)
Layer 3: Postgres  — RLS policies (is_management() function)
```

## Open Questions

- There is no UI for editing or deleting existing users — only creation via `AddUserForm`
- No mechanism exists for changing a user's role after creation (would require direct DB update or new Server Action)
- The `handle_new_user` trigger and the `addUser` action both insert into profiles — the action's upsert overwrites the trigger's default, creating a brief race window
