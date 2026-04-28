import { GoogleAuth } from "google-auth-library";
import type { Principal, Transition } from "@/types/schedule";

const TRANSITION_PREFIX_RE = /^\s*tt:\s*/i;

/**
 * If `title` begins with a `TT:` prefix (case-insensitive, allowing leading
 * whitespace and optional whitespace after the colon), return the title
 * with the prefix stripped and trimmed. Otherwise (or if the post-strip
 * title is empty), return `null`.
 */
export function stripTransitionPrefix(title: string): string | null {
  if (!TRANSITION_PREFIX_RE.test(title)) return null;
  const stripped = title.replace(TRANSITION_PREFIX_RE, "").trim();
  return stripped === "" ? null : stripped;
}

/**
 * Subset of the Google Calendar API event shape we rely on.
 * Full schema: https://developers.google.com/calendar/api/v3/reference/events
 */
export interface CalendarApiEvent {
  id?: string;
  summary?: string;
  start?: {
    date?: string;       // YYYY-MM-DD for all-day events
    dateTime?: string;   // RFC3339 for timed events
    timeZone?: string;   // IANA TZ name
  };
}

/**
 * Convert a slice of Calendar API events for a single principal into
 * `Transition` objects. Drops all-day events, untitled events, events
 * whose title doesn't start with `TT:`, and events whose post-strip
 * title is empty.
 */
export function parseCalendarEvents(
  person: Principal,
  events: CalendarApiEvent[]
): Transition[] {
  const transitions: Transition[] = [];
  for (const event of events) {
    if (!event.id) continue;
    if (!event.summary) continue;
    const startsAt = event.start?.dateTime;
    if (!startsAt) continue; // all-day or malformed
    const title = stripTransitionPrefix(event.summary);
    if (title === null) continue;
    transitions.push({
      person,
      title,
      startsAt,
      tz: event.start?.timeZone ?? "UTC",
      eventId: event.id,
    });
  }
  return transitions;
}

const PRINCIPAL_CALENDARS: { person: Principal; envVar: string }[] = [
  { person: "greg", envVar: "GOOGLE_CALENDAR_ID_GREG" },
  { person: "krista", envVar: "GOOGLE_CALENDAR_ID_KRISTA" },
];

export interface ConfiguredPrincipal {
  person: Principal;
  calendarIds: string[];
}

/**
 * Read the calendar ID env vars and return one entry per principal that
 * has at least one non-empty value. Each env var accepts a comma-separated
 * list, so a single principal can roll up multiple calendars (work +
 * personal etc.) into one subsection. Logs a warning for each missing /
 * empty principal so preview environments don't silently drop transitions.
 */
export function getConfiguredPrincipals(): ConfiguredPrincipal[] {
  const out: ConfiguredPrincipal[] = [];
  for (const { person, envVar } of PRINCIPAL_CALENDARS) {
    const raw = process.env[envVar];
    if (!raw) {
      console.warn(`[transitions] ${envVar} is not set; skipping ${person}`);
      continue;
    }
    const calendarIds = raw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== "");
    if (calendarIds.length === 0) {
      console.warn(`[transitions] ${envVar} has no non-empty calendar IDs; skipping ${person}`);
      continue;
    }
    out.push({ person, calendarIds });
  }
  return out;
}

const CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];

function getAuth() {
  return new GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    },
    scopes: CALENDAR_SCOPES,
  });
}

/**
 * Pad a `YYYY-MM-DD` date string by ±1 day and return RFC3339 UTC bounds.
 * The padding absorbs event-TZ vs. UTC date-boundary skew so events that
 * fall on the requested calendar date in their own TZ are not dropped by
 * the API's UTC-based timeMin/timeMax filter.
 */
function paddedRfc3339Bounds(startDate: string, endDate: string): { timeMin: string; timeMax: string } {
  const start = new Date(`${startDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(`${endDate}T23:59:59Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

async function fetchSingleCalendar(
  accessToken: string,
  person: Principal,
  calendarId: string,
  bounds: { timeMin: string; timeMax: string }
): Promise<Transition[]> {
  const params = new URLSearchParams({
    timeMin: bounds.timeMin,
    timeMax: bounds.timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    q: "TT:",
    maxResults: "2500",
  });
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
    calendarId
  )}/events?${params.toString()}`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      console.error(
        `[transitions] Calendar fetch for ${person} (${calendarId}) failed: ${response.status} ${response.statusText}`
      );
      return [];
    }
    const data = (await response.json()) as { items?: CalendarApiEvent[] };
    return parseCalendarEvents(person, data.items ?? []);
  } catch (error) {
    console.error(`[transitions] Calendar fetch for ${person} (${calendarId}) threw:`, error);
    return [];
  }
}

/**
 * Fetch TT: transitions across all configured principals' Google Calendars
 * for the given inclusive date range. Returns a flat array sorted ascending
 * by startsAt. Per-principal failures degrade to an empty contribution from
 * that principal; the call as a whole only throws if obtaining the access
 * token fails.
 */
export async function fetchTransitions(
  range: { startDate: string; endDate: string }
): Promise<Transition[]> {
  const principals = getConfiguredPrincipals();
  if (principals.length === 0) return [];

  const auth = getAuth();
  const accessToken = await auth.getAccessToken();
  if (!accessToken) throw new Error("Missing Google Calendar access token");

  const bounds = paddedRfc3339Bounds(range.startDate, range.endDate);

  const fetches = principals.flatMap((p) =>
    p.calendarIds.map((calendarId) =>
      fetchSingleCalendar(accessToken, p.person, calendarId, bounds)
    )
  );
  const results = await Promise.all(fetches);

  return mergeAndSortTransitions(results.flat());
}

/**
 * Deduplicate transitions by (person, eventId), keeping the first occurrence,
 * then sort ascending by startsAt. The dedup matters because a single event
 * can appear on more than one of a principal's calendars (e.g. Krista has
 * the same event on both her personal and work calendars) — without dedup
 * the UI gets duplicate React keys.
 */
export function mergeAndSortTransitions(transitions: Transition[]): Transition[] {
  const seen = new Set<string>();
  const out: Transition[] = [];
  for (const t of transitions) {
    const key = `${t.person}:${t.eventId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  out.sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
  return out;
}
