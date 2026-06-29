import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, datesBetween, isoDateInTz } from "@/lib/schedule-utils";
import { fetchSchedule } from "@/lib/google-sheets";
import { fetchTransitions } from "@/lib/google-calendar";
import {
  getAllAssignmentsWithProfiles,
  getDateSettings,
  getScheduleRows,
  getSnapshotDates,
  getTravelLegs,
  upsertScheduleRows,
  upsertSnapshot,
} from "@/lib/supabase/queries";
import {
  assembleDashboardEntry,
  type AssembleSources,
  type DateLegs,
} from "./assemble";
import type {
  DetailLevel,
  Profile,
  ScheduleEntry,
  Transition,
  TravelLeg,
} from "@/types/schedule";

const CRON_LOOKBACK_DAYS = 7;

/**
 * Internal: retry a fallible async op up to `attempts` times with `delayMs`
 * between tries. Used to harden live-source fetches against transient
 * cold-start failures (e.g., Google Sheets API).
 */
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  attempts = 2,
  delayMs = 500
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

/**
 * Pure: dates in [today-7, today-1] that are NOT in `existing`.
 * Caller passes in the set of already-snapshotted dates.
 */
export function selectMissingDatesForCron(
  today: string,
  existing: Set<string>
): string[] {
  const start = addDays(today, -CRON_LOOKBACK_DAYS);
  const end = addDays(today, -1);
  return datesBetween(start, end).filter((d) => !existing.has(d));
}

export interface RunSnapshotResult {
  snapshotted: string[];
  unrecoverable: string[];
  alreadyFrozen: string[];
  /** Rows returned by the live sheet fetch this run (reconciler only). 0 = sheet sync broken. */
  liveScheduleCount?: number;
}

/**
 * Capture missing snapshots in [today-7, today-1].
 *
 * NOTE: the nightly cron route now calls `runMirrorReconcile`, which is a
 * superset (freezes every unfrozen past date the mirror/live sheet has, not just
 * the last 7 days). This 7-day variant is retained for its focused window and is
 * covered by `selectMissingDatesForCron` tests.
 */
export async function runSnapshotForCron(
  supabase: SupabaseClient,
  today: string
): Promise<RunSnapshotResult> {
  const candidates = datesBetween(
    addDays(today, -CRON_LOOKBACK_DAYS),
    addDays(today, -1)
  );
  const existing = await getSnapshotDates(supabase, candidates);
  const missing = selectMissingDatesForCron(today, existing);

  if (missing.length === 0) {
    return {
      snapshotted: [],
      unrecoverable: [],
      alreadyFrozen: Array.from(existing),
    };
  }

  const sources = await fetchAllLiveSources(supabase, today);

  return runSnapshotForDates(missing, sources, "cron", existing);
}

/**
 * Capture snapshots for a specific list of past dates using already-fetched
 * live sources. Used by the dashboard's lazy backfill path so we don't re-fetch
 * the sheet per request.
 */
export async function runSnapshotForDates(
  dates: string[],
  sources: AssembleSources,
  frozenBy: "cron" | "lazy",
  alreadyFrozen?: Set<string>
): Promise<RunSnapshotResult> {
  const result: RunSnapshotResult = {
    snapshotted: [],
    unrecoverable: [],
    alreadyFrozen: alreadyFrozen ? Array.from(alreadyFrozen) : [],
  };
  for (const date of dates) {
    const entry = assembleDashboardEntry(date, sources);
    if (!entry) {
      result.unrecoverable.push(date);
      continue;
    }
    const inserted = await upsertSnapshot({ date, payload: entry, frozenBy });
    if (inserted) result.snapshotted.push(date);
    else result.unrecoverable.push(date); // already exists or insert failed
  }
  return result;
}

/**
 * Pure: every past date (< today) we have content for — from the durable mirror
 * (deleted-from-sheet rows) or the live sheet — that is NOT already frozen.
 * The basis of the full-range reconciler; tested independently of I/O.
 */
export function selectUnfrozenPastDates(
  today: string,
  mirrorDates: string[],
  liveScheduleDates: string[],
  existing: Set<string>
): string[] {
  const past = new Set<string>();
  for (const d of mirrorDates) if (d < today) past.add(d);
  for (const d of liveScheduleDates) if (d < today) past.add(d);
  return Array.from(past)
    .filter((d) => !existing.has(d))
    .sort();
}

/**
 * Pure: turn a finished cron run into a list of human-readable health issues.
 * Empty list = healthy. Used to drive the capture alert (Defect 3 / observability).
 */
export function assessCaptureHealth(args: {
  liveScheduleCount: number;
  unrecoverable: string[];
}): string[] {
  const issues: string[] = [];
  if (args.liveScheduleCount === 0) {
    issues.push(
      "Google Sheet fetch returned 0 rows — sheet sync may be broken (API creds, " +
        "network, or sheet structure changed). No new content is being captured."
    );
  }
  if (args.unrecoverable.length > 0) {
    issues.push(
      `${args.unrecoverable.length} past date(s) could not be frozen into a ` +
        `snapshot: ${args.unrecoverable.join(", ")}.`
    );
  }
  return issues;
}

/**
 * Full-range reconciler: freeze EVERY past date the mirror or live sheet has but
 * `card_snapshots` lacks — not just the cron's fixed 7-day window. The mirror is
 * the durable time capsule; this guarantees each captured day also becomes a
 * durable snapshot, closing long-tail gaps (e.g. a day nobody browsed within a
 * week). `liveScheduleCount` is surfaced so the caller can alert on an empty
 * sheet fetch.
 */
export async function runMirrorReconcile(
  supabase: SupabaseClient,
  today: string
): Promise<RunSnapshotResult> {
  const sources = await fetchAllLiveSources(supabase, today);
  const liveScheduleCount = sources.schedule.length;
  const mirrorDates = Array.from(sources.mirrorByDate?.keys() ?? []);
  const liveDates = sources.schedule.map((s) => s.date);

  const candidates = selectUnfrozenPastDates(today, mirrorDates, liveDates, new Set());
  if (candidates.length === 0) {
    return { snapshotted: [], unrecoverable: [], alreadyFrozen: [], liveScheduleCount };
  }
  const existing = await getSnapshotDates(supabase, candidates);
  const missing = candidates.filter((d) => !existing.has(d));
  if (missing.length === 0) {
    return {
      snapshotted: [],
      unrecoverable: [],
      alreadyFrozen: Array.from(existing),
      liveScheduleCount,
    };
  }
  const result = await runSnapshotForDates(missing, sources, "cron", existing);
  return { ...result, liveScheduleCount };
}

/**
 * Fetch every source the dashboard would, with no date filtering, so the
 * caller can re-key or join freely. The full sheet/calendar read-through
 * matches the existing dashboard fetch behavior.
 */
export async function fetchAllLiveSources(
  supabase: SupabaseClient,
  today: string
): Promise<AssembleSources> {
  const [schedule, dateSettingsRows, assignmentsRaw, travelLegsRaw, mirrorRows] =
    await fetchWithRetry(() =>
      Promise.all([
        fetchSchedule(),
        getDateSettings(supabase),
        getAllAssignmentsWithProfiles(supabase),
        getTravelLegs(supabase),
        // Past mirror rows (date < today) as a fallback for sheet rows that
        // have since been deleted. Reads tolerate failure (returns []).
        getScheduleRows(supabase, today),
      ])
    );

  // Durably mirror the rows we just read so a later sheet deletion can't
  // destroy this content. Best-effort: never blocks assembly.
  await upsertScheduleRows(schedule);

  // Build the deleted-row fallback map. Only keep mirrored dates the live sheet
  // no longer has, so a present live row always wins.
  const liveDates = new Set(schedule.map((s) => s.date));
  const mirrorByDate = new Map<string, ScheduleEntry>();
  for (const row of mirrorRows) {
    if (!liveDates.has(row.date)) mirrorByDate.set(row.date, row);
  }

  // Transitions need a date range. Cover today-7 through whatever the
  // furthest sheet date is.
  const sheetMaxDate = schedule.reduce(
    (max, s) => (s.date > max ? s.date : max),
    today
  );
  const transitions: Transition[] =
    schedule.length === 0
      ? []
      : await fetchTransitions({
          startDate: addDays(today, -CRON_LOOKBACK_DAYS),
          endDate: sheetMaxDate,
        });

  // Bucket the raw rows. Unlike dashboard/page.tsx, we do NOT filter to
  // `knownDates` — a snapshot for a past date may need transitions for a
  // schedule row that has since rolled out of the live sheet.
  const transitionsByDate = new Map<string, Transition[]>();
  for (const t of transitions) {
    const date = isoDateInTz(t.startsAt, t.tz);
    const list = transitionsByDate.get(date) ?? [];
    list.push(t);
    transitionsByDate.set(date, list);
  }

  // The Supabase query returns `profiles` as a join; the runtime shape
  // matches `dashboard/page.tsx`'s cast. Mirror that here so freeze and
  // dashboard agree on the bucketing.
  const assignmentsByDate = new Map<
    string,
    Pick<Profile, "id" | "fullName" | "email">[]
  >();
  for (const a of assignmentsRaw) {
    const epoInfo = (
      a as { profiles: { id: string; full_name: string; email: string } | null }
    ).profiles;
    if (!epoInfo) continue;
    const date = (a as { date: string }).date;
    const existing = assignmentsByDate.get(date) ?? [];
    existing.push({
      id: epoInfo.id,
      fullName: epoInfo.full_name,
      email: epoInfo.email,
    });
    assignmentsByDate.set(date, existing);
  }

  const travelLegsByDate = new Map<string, DateLegs>();
  for (const tl of travelLegsRaw) {
    const row = tl as {
      date: string;
      action: string;
      location: string;
      time: string;
      companion: string;
      companion_pre_position_flight: string;
      teak_flight: string;
      companion_return_flight: string;
    };
    const leg: TravelLeg = {
      date: row.date,
      action: row.action as TravelLeg["action"],
      location: row.location,
      time: row.time,
      companion: row.companion,
      companionPrePositionFlight: row.companion_pre_position_flight,
      teakFlight: row.teak_flight,
      companionReturnFlight: row.companion_return_flight,
    };
    const existing = travelLegsByDate.get(row.date) ?? {};
    if (leg.action === "Pick up") existing.pickup = leg;
    else if (leg.action === "Drop off") existing.dropoff = leg;
    travelLegsByDate.set(row.date, existing);
  }

  const settingsMap = new Map<string, { detailLevel: DetailLevel }>();
  for (const ds of dateSettingsRows as {
    date: string;
    detail_level: string;
  }[]) {
    settingsMap.set(ds.date, {
      detailLevel: ds.detail_level as DetailLevel,
    });
  }

  const sources: AssembleSources = {
    schedule: schedule as ScheduleEntry[],
    transitionsByDate,
    assignmentsByDate,
    travelLegsByDate,
    settingsMap,
    mirrorByDate,
  };
  return sources;
}

/**
 * Pre-rollover capture: snapshot today's data BEFORE midnight rolls it
 * into "yesterday." Run by the 23:55 PT timer. Idempotent — if today
 * already has a snapshot (from a manual run or earlier retry), skip.
 *
 * The captured row's date column is today's date, which means after
 * midnight when the dashboard treats it as past, the snapshot is read
 * exactly like any cron-captured snapshot.
 */
export async function runPreRolloverSnapshot(
  supabase: SupabaseClient,
  today: string
): Promise<RunSnapshotResult> {
  const existing = await getSnapshotDates(supabase, [today]);
  if (existing.has(today)) {
    return { snapshotted: [], unrecoverable: [], alreadyFrozen: [today] };
  }
  const sources = await fetchAllLiveSources(supabase, today);
  return runSnapshotForDates([today], sources, "cron", existing);
}
