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
  calendarId: string;
}

/**
 * Read the calendar ID env vars and return one entry per principal that
 * has a non-empty value. Logs a warning for each missing principal so
 * preview environments (which may only have one calendar shared) don't
 * silently drop transitions for the missing one.
 */
export function getConfiguredPrincipals(): ConfiguredPrincipal[] {
  const out: ConfiguredPrincipal[] = [];
  for (const { person, envVar } of PRINCIPAL_CALENDARS) {
    const calendarId = process.env[envVar];
    if (!calendarId) {
      console.warn(`[transitions] ${envVar} is not set; skipping ${person}`);
      continue;
    }
    out.push({ person, calendarId });
  }
  return out;
}
