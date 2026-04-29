import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, datesBetween, isoDateInTz } from "@/lib/schedule-utils";
import { fetchSchedule } from "@/lib/google-sheets";
import { fetchTransitions } from "@/lib/google-calendar";
import {
  getAllAssignmentsWithProfiles,
  getDateSettings,
  getSnapshotDates,
  getTravelLegs,
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
}

/**
 * Capture missing snapshots in [today-7, today-1].
 * Used by both the nightly cron endpoint and (with a different `dates`
 * computation) the lazy backfill in the dashboard read path.
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

  return runSnapshotForDates(supabase, missing, sources, "cron", existing);
}

/**
 * Capture snapshots for a specific list of past dates using already-fetched
 * live sources. Used by the dashboard's lazy backfill path so we don't re-fetch
 * the sheet per request.
 */
export async function runSnapshotForDates(
  supabase: SupabaseClient,
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
    const inserted = await upsertSnapshot(supabase, {
      date,
      payload: entry,
      frozenBy,
    });
    if (inserted) result.snapshotted.push(date);
    else result.unrecoverable.push(date); // already exists or insert failed
  }
  return result;
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
  const [schedule, dateSettingsRows, assignmentsRaw, travelLegsRaw] =
    await Promise.all([
      fetchSchedule(),
      getDateSettings(supabase),
      getAllAssignmentsWithProfiles(supabase),
      getTravelLegs(supabase),
    ]);

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
  };
  return sources;
}
