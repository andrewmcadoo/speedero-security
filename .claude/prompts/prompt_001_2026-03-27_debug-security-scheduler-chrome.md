# Prompt: Debug Security Scheduler in Chrome

> Generated: 2026-03-27 | Framework: Agentic Task

---

## Session Goal

Create a prompt for using Chrome browser automation tools to debug and visually verify the Security Scheduler web app — testing login flow, dashboard rendering, role-based views, and Google Sheets data integration in a live browser session.

## Framework Selection

- **Chosen:** Agentic Task
- **Rationale:** Autonomous agent task using Chrome browser tools to navigate, interact, and verify a web app — needs specific file references, verification steps with expected outcomes, and scope constraints.
- **Alternatives considered:** RISEN (good for step-by-step) but Agentic Task is purpose-built for Claude Code agent prompts with verification loops.

## Evaluation Scores

| Dimension | Score | Notes |
|-----------|-------|-------|
| Clarity | 9/10 | Task is unambiguous — debug and verify, not build |
| Specificity | 9/10 | Exact routes, components, expected behaviors listed |
| Context | 9/10 | Covers env requirements, auth setup, tool names, fallback paths |
| Completeness | 9/10 | All routes, interactions, edge cases, and output format covered |
| Structure | 9/10 | Clean Agentic Task format with phased verification |
| **Overall** | **9/10** | |

---

## Structured Prompt

> Copy-paste ready. This is the primary deliverable.

```
TASK:
Debug and visually verify the Security Scheduler web app in Chrome. Navigate through the login flow, dashboard views (EPO and management), admin panel, and Google Sheets data rendering. Identify rendering issues, broken interactions, auth redirects, and data display problems.

REFERENCES:
- src/app/login/page.tsx — Google SSO login page, entry point
- src/app/auth/callback/route.ts — OAuth callback handler, login will fail silently if misconfigured
- src/app/dashboard/page.tsx — Server component that routes to EPO or management view based on role
- src/app/dashboard/epo-dashboard.tsx — EPO card list view (read-only, filtered to assigned dates)
- src/app/dashboard/management-dashboard.tsx — Management view with filters, search, expanded cards, EPO assignment
- src/app/admin/users/page.tsx — User role management (management-only)
- src/components/management-card.tsx — Expandable card with logistics, detail counter, EPO assignment
- src/components/epo-assignment.tsx — Tag chips + assign dropdown
- src/components/detail-counter.tsx — Editable min detail (+/-)
- src/app/api/schedule/route.ts — Google Sheets data endpoint
- docs/superpowers/specs/2026-03-27-security-scheduler-design.md — Full design spec

OUTPUT:
For each verification item, report:
- Status: PASS / FAIL / BLOCKED
- What was observed (brief description)
- Screenshot if the item failed

Summarize all blockers at the end. If a phase is blocked, skip to the next phase and mark all skipped items as BLOCKED with reason.

VERIFICATION:

Phase 1 — Auth Flow (prerequisite for all other phases):
1. `/login` renders the "Sign in with Google" button and is visually styled (not unstyled/broken)
2. Unauthenticated visits to `/dashboard` redirect to `/login`
3. After login, user is redirected to `/dashboard`
   → If Google SSO login fails, STOP. Report it as a blocker. Do not attempt to test authenticated routes.

Phase 2 — Management Dashboard (requires management-role user):
   → If no management user exists, document the required SQL: `UPDATE profiles SET role = 'management' WHERE email = '<user-email>';` and mark all Phase 2 items as BLOCKED.
4. `/dashboard` renders the management view: all dates visible, filter tabs present, search input visible
5. Management cards expand on click to show logistics grid (transitions, lodging, night location, flights, ground transport, comments)
6. Detail counter (+/-) buttons update value without page reload
7. "+ Assign" dropdown lists available EPOs and adds a chip on selection; "x" removes a chip
8. Filter tabs (All Dates, Unassigned, This Week, Next Week) correctly narrow displayed entries
9. Search input filters cards by activity name or location
10. Coverage badges show correct color coding (red = 0 assigned, yellow = under-staffed, green = met)
11. If schedule data is empty (no Google Sheets credentials), dashboard shows the empty state message ("No schedule data / Check your Google Sheets connection") — not a blank page or unhandled error

Phase 3 — EPO Dashboard (requires epo-role user):
12. `/dashboard` renders the EPO view: card list filtered to assigned dates only, no management controls visible
13. Each card shows date, confirmation status badge (color-coded), activity, location, and minimum detail

Phase 4 — Admin Panel:
14. `/admin/users` is accessible to management users and shows user list with role toggle buttons
15. Non-management users accessing `/admin/users` are redirected to `/dashboard`

Phase 5 — Responsive:
16. At mobile viewport (375px): no horizontal scrollbar, cards fill full width in a single column, text is not truncated to illegibility

CONSTRAINTS:
- Don't modify any source files — this is a debug/verification session only
- Don't create or modify database records directly — document what needs manual setup
- Don't dismiss browser dialogs if triggered — report them and stop
- If Chrome tools fail after 2-3 attempts, stop and report what happened
- If any listed Chrome tool is unavailable, report which tool is missing and stop

CONTEXT:
- The app requires `.env.local` with Supabase and Google Sheets credentials configured
- The dev server runs on http://localhost:3000 via `bun dev`
- Google SSO must be configured in both Supabase dashboard and Google Cloud Console
- First user defaults to `epo` role — must be promoted to `management` via SQL to test management views
- The Google Sheets API will fail without a valid service account — empty schedule data is expected without credentials
- Use mcp__claude-in-chrome__* tools: start with tabs_context_mcp, create tabs with tabs_create_mcp, read pages with read_page/get_page_text, interact with computer/form_input
```

---

## Review Findings

### Issues Addressed
1. **[Warning] Missing output format** — Added OUTPUT section specifying PASS/FAIL/BLOCKED per item with screenshots on failure
2. **[Warning] Blocked auth fallback** — Added explicit stop instruction after Phase 1 step 3 if login fails
3. **[Warning] Management user constraint tension** — Added explicit skip-and-document guidance at Phase 2 header
4. **[Suggestion] Phased verification** — Grouped 16 items into 5 phases with dependency ordering
5. **[Suggestion] Mobile specifics** — Changed vague "stack properly" to "no horizontal scrollbar, cards fill full width, single column"
6. **[Suggestion] Empty state verification** — Added item 11 for empty schedule data handling
7. **[Suggestion] Auth callback reference** — Added `src/app/auth/callback/route.ts` to REFERENCES
8. **[Suggestion] Tool unavailability** — Added constraint for missing Chrome tools

### Remaining Suggestions
- Could add console error monitoring (`read_console_messages`) as a verification dimension across all phases
- Could capture network request failures (`read_network_requests`) for the `/api/schedule` endpoint

## Usage Notes

- **Best used with:** Claude Code with `mcp__claude-in-chrome__*` tools available
- **Adjust for:** Environment-specific URLs if not running on localhost:3000; update the management user email in Phase 2 blocker SQL
