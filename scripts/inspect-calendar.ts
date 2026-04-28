/**
 * Inspect a principal's Google Calendar(s) from the service account's view.
 *
 * Usage:
 *   bun run scripts/inspect-calendar.ts greg
 *   bun run scripts/inspect-calendar.ts krista
 *
 * Reads .env.local for GOOGLE_SHEETS_CLIENT_EMAIL/PRIVATE_KEY and the
 * GOOGLE_CALENDAR_ID_<PERSON> env var. The env var may be a single ID or
 * a comma-separated list — each calendar is inspected separately. Lists
 * every event in the next 60 days as the service account sees them, with
 * a flag indicating whether the title would match the TT: prefix filter.
 */
import { GoogleAuth } from "google-auth-library";

type CalEvent = {
  id?: string;
  summary?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
};

const TT_RE = /^\s*tt:\s*/i;

async function inspectOne(accessToken: string, calendarId: string, window: { now: Date; in60: Date }) {
  const params = new URLSearchParams({
    timeMin: window.now.toISOString(),
    timeMax: window.in60.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "2500",
  });
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

  console.log(`\n=== ${calendarId} ===`);

  if (!res.ok) {
    const body = await res.text();
    console.error(`  HTTP ${res.status} ${res.statusText}`);
    console.error(`  ${body.split("\n").slice(0, 5).join("\n  ")}`);
    return { matchCount: 0, eventCount: 0, ok: false };
  }

  const data = (await res.json()) as { items?: CalEvent[]; summary?: string; timeZone?: string };
  const events = data.items ?? [];

  console.log(`  Calendar: ${data.summary ?? calendarId}  (TZ: ${data.timeZone ?? "?"})`);
  console.log(`  Total events: ${events.length}`);

  let matchCount = 0;
  for (const e of events) {
    const start = e.start?.dateTime ?? e.start?.date ?? "?";
    const allDay = !e.start?.dateTime;
    const summary = e.summary ?? "(no title)";
    const matches = !!e.summary && TT_RE.test(e.summary);
    if (matches) matchCount++;
    const flag = matches ? "✓ TT" : allDay ? "  ad" : "    ";
    console.log(`    ${flag}  ${start.padEnd(28)}  ${summary}`);
  }

  console.log(`  TT: matches: ${matchCount} / ${events.length}`);
  return { matchCount, eventCount: events.length, ok: true };
}

async function main() {
  const person = (process.argv[2] ?? "").toLowerCase();
  if (person !== "greg" && person !== "krista") {
    console.error("Usage: bun run scripts/inspect-calendar.ts <greg|krista>");
    process.exit(1);
  }

  const envVar = `GOOGLE_CALENDAR_ID_${person.toUpperCase()}`;
  const raw = process.env[envVar];
  if (!raw) {
    console.error(`${envVar} not set. Add it to .env.local.`);
    process.exit(1);
  }

  const calendarIds = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
  if (calendarIds.length === 0) {
    console.error(`${envVar} has no non-empty calendar IDs.`);
    process.exit(1);
  }

  const auth = new GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  });
  const accessToken = await auth.getAccessToken();
  if (!accessToken) throw new Error("Missing access token");

  const window = {
    now: new Date(),
    in60: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
  };

  console.log(`Person: ${person}`);
  console.log(`Calendars: ${calendarIds.length}`);
  console.log(`Window:   ${window.now.toISOString()} → ${window.in60.toISOString()}`);

  let totalMatches = 0;
  let totalEvents = 0;
  let failures = 0;
  for (const calendarId of calendarIds) {
    const r = await inspectOne(accessToken, calendarId, window);
    totalMatches += r.matchCount;
    totalEvents += r.eventCount;
    if (!r.ok) failures++;
  }

  console.log(`\n--- Summary ---`);
  console.log(`Calendars OK:    ${calendarIds.length - failures} / ${calendarIds.length}`);
  console.log(`TT: matches:     ${totalMatches} / ${totalEvents} total events`);
  console.log(`(✓ TT = would render; "ad" = all-day dropped; blank = no TT: prefix)\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
