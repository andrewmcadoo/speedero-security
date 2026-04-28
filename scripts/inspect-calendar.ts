/**
 * Inspect a principal's Google Calendar from the service account's view.
 *
 * Usage:
 *   bun run scripts/inspect-calendar.ts greg
 *   bun run scripts/inspect-calendar.ts krista
 *
 * Reads .env.local for GOOGLE_SHEETS_CLIENT_EMAIL/PRIVATE_KEY and the
 * GOOGLE_CALENDAR_ID_<PERSON> env var. Lists every event in the next 60
 * days as the service account sees them — title, start, all-day flag,
 * and whether the title would match the TT: prefix filter.
 */
import { GoogleAuth } from "google-auth-library";

type CalEvent = {
  id?: string;
  summary?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
};

const TT_RE = /^\s*tt:\s*/i;

async function main() {
  const person = (process.argv[2] ?? "").toLowerCase();
  if (person !== "greg" && person !== "krista") {
    console.error("Usage: bun run scripts/inspect-calendar.ts <greg|krista>");
    process.exit(1);
  }

  const envVar = `GOOGLE_CALENDAR_ID_${person.toUpperCase()}`;
  const calendarId = process.env[envVar];
  if (!calendarId) {
    console.error(`${envVar} not set. Add it to .env.local.`);
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

  const now = new Date();
  const in60 = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: in60.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    q: "TT:",
    maxResults: "2500",
  });
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const body = await res.text();
    console.error(`HTTP ${res.status} ${res.statusText}\n${body}`);
    process.exit(1);
  }

  const data = (await res.json()) as { items?: CalEvent[]; summary?: string; timeZone?: string };
  const events = data.items ?? [];

  console.log(`\nCalendar: ${data.summary ?? calendarId}  (TZ: ${data.timeZone ?? "?"})`);
  console.log(`Window:   ${now.toISOString()} → ${in60.toISOString()}`);
  console.log(`Total events: ${events.length}\n`);

  let matchCount = 0;
  for (const e of events) {
    const start = e.start?.dateTime ?? e.start?.date ?? "?";
    const allDay = !e.start?.dateTime;
    const summary = e.summary ?? "(no title)";
    const matches = !!e.summary && TT_RE.test(e.summary);
    if (matches) matchCount++;
    const flag = matches ? "✓ TT" : allDay ? "  ad" : "    ";
    console.log(`  ${flag}  ${start.padEnd(28)}  ${summary}`);
  }

  console.log(`\nTT: matches: ${matchCount} / ${events.length} total`);
  console.log(`(✓ TT = would render as transition; "ad" = all-day, dropped; blank = wrong prefix)\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
