import type {
  DashboardEntry,
  DetailLevel,
  Profile,
  ScheduleEntry,
  Transition,
  TravelLeg,
} from "@/types/schedule";

export interface DateLegs {
  pickup?: TravelLeg;
  dropoff?: TravelLeg;
}

export interface AssembleSources {
  schedule: ScheduleEntry[];
  transitionsByDate: Map<string, Transition[]>;
  assignmentsByDate: Map<string, Pick<Profile, "id" | "fullName" | "email">[]>;
  travelLegsByDate: Map<string, DateLegs>;
  settingsMap: Map<string, { detailLevel: DetailLevel }>;
  /**
   * Durable fallback for schedule rows that have been deleted from the live
   * sheet. Keyed by date. Used only when the live `schedule` has no row for a
   * date, so a past card can still be assembled (and frozen) after its sheet
   * row is gone. Absent in the live forward-view path, so deleted future rows
   * stay hidden going forward.
   */
  mirrorByDate?: Map<string, ScheduleEntry>;
}

/**
 * Build a single DashboardEntry by joining a schedule row with the
 * supplementary data for that date. Returns null when no schedule row
 * exists for `date`.
 *
 * This is the pure shape that both the live dashboard and the snapshot
 * freezer use — keeping it factored here means a snapshot is byte-for-byte
 * the same as a live render, which is the contract that lets us serve
 * past cards from snapshots without divergent rendering.
 */
export function assembleDashboardEntry(
  date: string,
  sources: AssembleSources
): DashboardEntry | null {
  // Prefer the live sheet row; fall back to the durable mirror when the row
  // has been deleted from the sheet. The mirror is only populated for past
  // dates, so the live forward view is unaffected by deleted future rows.
  const row =
    sources.schedule.find((s) => s.date === date) ??
    sources.mirrorByDate?.get(date);
  if (!row) return null;
  const setting = sources.settingsMap.get(date);
  const legs = sources.travelLegsByDate.get(date);
  return {
    ...row,
    detailLevel: setting?.detailLevel ?? "single",
    assignedEpos: sources.assignmentsByDate.get(date) ?? [],
    pickupLeg: legs?.pickup,
    dropoffLeg: legs?.dropoff,
    transitions: sources.transitionsByDate.get(date) ?? [],
  };
}

/**
 * Placeholder entry for a past date the user picked but for which we have
 * no snapshot and no surviving live row. Renders as a "?" card.
 */
export function emptyMissingEntry(date: string): DashboardEntry {
  return {
    date,
    dayOfWeek: "",
    confirmationStatus: "unconfirmed",
    teakNight: false,
    activity: "",
    location: "",
    coPilot: "",
    flightInfo: "",
    departure: { airport: "", fbo: "", time: "" },
    arrival: { airport: "", fbo: "", time: "" },
    internationalPax: "",
    groundTransport: "",
    lodging: "",
    comments: "",
    rowId: `missing-${date}`,
    detailLevel: "single",
    assignedEpos: [],
    transitions: [],
    isPast: true,
    isMissing: true,
  };
}
