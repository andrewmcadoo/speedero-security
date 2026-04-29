import { createClient } from "@/lib/supabase/server";
import {
  getProfile,
  getAssignmentsForUser,
  getAllEpos,
  getSnapshotsBetween,
} from "@/lib/supabase/queries";
import type { DashboardEntry } from "@/types/schedule";
import {
  addDays,
  datesBetween,
  getAnchorDates,
  isNextWeek,
  isThisWeek,
  maxDate,
  minDate,
} from "@/lib/schedule-utils";
import {
  assembleDashboardEntry,
  emptyMissingEntry,
} from "@/lib/snapshot/assemble";
import { fetchAllLiveSources, runSnapshotForDates } from "@/lib/snapshot/freeze";
import { parseRangeFromSearchParams } from "@/lib/dashboard/range";
import { EpoDashboard } from "./epo-dashboard";
import { ManagementDashboard } from "./management-dashboard";
import { redirect } from "next/navigation";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();

  let profile;
  try {
    profile = await getProfile(supabase);
  } catch {
    redirect("/login");
  }

  if (!profile) {
    redirect("/login");
  }

  const { today, tomorrow } = getAnchorDates();
  const params = await searchParams;
  const range = parseRangeFromSearchParams(params, {
    today,
    role: profile.role as "epo" | "management",
  });
  const isManagement = profile.role === "management";

  // Compute past/live split.
  // liveStart clamps to today (snapshots own dates < today; live owns >=).
  // When the picked range starts in the future, the user wants only their
  // picked window — not "today through range.end".
  const liveStart = range.end >= today ? maxDate(range.start, today) : null;
  const liveEnd = range.end >= today ? range.end : null;
  const pastStart = range.start < today ? range.start : null;
  const pastEnd = range.start < today ? minDate(range.end, addDays(today, -1)) : null;

  // Live sources (full sheet/calendar read). Needed for two reasons:
  //   1. Rendering today/future cards (when liveStart !== null).
  //   2. Lazy-backfilling missing past snapshots — without live data, a
  //      past-only range can't backfill and renders dates outside the
  //      cron's lookback window as "? no snapshot" placeholders.
  // Degrades gracefully on Sheets/Calendar failure so the dashboard still
  // renders with whatever snapshots exist instead of bouncing to error.tsx.
  const needLiveSources =
    liveStart !== null || (pastStart !== null && pastEnd !== null);
  const liveSourcesPromise = needLiveSources
    ? fetchAllLiveSources(supabase, today).catch((err) => {
        console.error("[dashboard] fetchAllLiveSources failed:", err);
        return null;
      })
    : Promise.resolve(null);

  const snapshotsPromise =
    pastStart !== null && pastEnd !== null
      ? getSnapshotsBetween(supabase, pastStart, pastEnd)
      : Promise.resolve([]);

  const [liveSources, snapshotsRaw] = await Promise.all([
    liveSourcesPromise,
    snapshotsPromise,
  ]);

  // Lazy backfill any past gaps in the requested range.
  let backfilled: typeof snapshotsRaw = [];
  if (pastStart !== null && pastEnd !== null && liveSources) {
    const have = new Set(snapshotsRaw.map((s) => s.date));
    const requestedPast = datesBetween(pastStart, pastEnd);
    const missing = requestedPast.filter((d) => !have.has(d));
    if (missing.length > 0) {
      const result = await runSnapshotForDates(
        supabase,
        missing,
        liveSources,
        "lazy"
      );
      if (result.snapshotted.length > 0) {
        const fresh = await getSnapshotsBetween(supabase, pastStart, pastEnd);
        backfilled = fresh.filter((s) => !have.has(s.date));
      }
    }
  }
  const allSnapshots = [...snapshotsRaw, ...backfilled];

  // EPO-specific assigned-dates info, only needed for the EPO branch's
  // travel-leg visibility filter.
  const myAssignments = !isManagement
    ? await getAssignmentsForUser(supabase, profile.id)
    : [];
  const assignedDates = myAssignments.map((a: { date: string }) => a.date);
  const assignedDateSet = new Set(assignedDates);

  // Build past entries from snapshots — payloads are already complete
  // DashboardEntry objects, just stamp isPast/isThisWeek/isNextWeek.
  const pastEntries: DashboardEntry[] = allSnapshots.map((s) => ({
    ...s.payload,
    isPast: true,
    isFromSnapshot: true,
    isThisWeek: isThisWeek(s.date),
    isNextWeek: isNextWeek(s.date),
  }));

  // Build live entries from sources for [today..range.end].
  const liveEntries: DashboardEntry[] = (() => {
    if (liveStart === null || liveEnd === null || !liveSources) return [];
    return liveSources.schedule
      .filter((s) => s.date >= liveStart && s.date <= liveEnd)
      .map((s) => {
        const base = assembleDashboardEntry(s.date, liveSources)!;
        const epoLegs =
          !isManagement && !assignedDateSet.has(s.date)
            ? { pickupLeg: undefined, dropoffLeg: undefined }
            : {};
        return {
          ...base,
          ...epoLegs,
          isPast: false,
          isThisWeek: isThisWeek(s.date),
          isNextWeek: isNextWeek(s.date),
        };
      });
  })();

  // Missing past placeholders — past dates the user explicitly asked for
  // that have neither a snapshot nor a live row.
  const haveDates = new Set([
    ...pastEntries.map((e) => e.date),
    ...liveEntries.map((e) => e.date),
  ]);
  const missingPast: DashboardEntry[] =
    pastStart !== null && pastEnd !== null
      ? datesBetween(pastStart, pastEnd)
          .filter((d) => !haveDates.has(d))
          .map((d) => emptyMissingEntry(d))
      : [];

  const entries = [...pastEntries, ...missingPast, ...liveEntries].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  if (isManagement) {
    const epos = await getAllEpos(supabase, profile.id);
    return (
      <ManagementDashboard
        entries={entries}
        epos={epos.map((e: { id: string; full_name: string; email: string }) => ({
          id: e.id,
          fullName: e.full_name,
          email: e.email,
        }))}
        profileId={profile.id}
        todayISO={today}
        tomorrowISO={tomorrow}
        range={range}
      />
    );
  }

  return (
    <EpoDashboard
      entries={entries}
      assignedDates={assignedDates}
      userName={profile.fullName}
      todayISO={today}
      tomorrowISO={tomorrow}
      range={range}
    />
  );
}
