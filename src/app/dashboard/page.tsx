import { createClient } from "@/lib/supabase/server";
import { getProfile, getAssignmentsForUser, getDateSettings, getAllAssignmentsWithProfiles, getAllEpos, getTravelLegs } from "@/lib/supabase/queries";
import { fetchSchedule } from "@/lib/google-sheets";
import type { ScheduleEntry, DashboardEntry, DetailLevel, TravelLeg } from "@/types/schedule";
import { isThisWeek, isNextWeek, getAnchorDates } from "@/lib/schedule-utils";
import { EpoDashboard } from "./epo-dashboard";
import { ManagementDashboard } from "./management-dashboard";
import { redirect } from "next/navigation";

async function fetchScheduleData(): Promise<ScheduleEntry[]> {
  try {
    return await fetchSchedule();
  } catch (error) {
    console.error("fetchSchedule failed:", error);
    return [];
  }
}

export default async function DashboardPage() {
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
  const isManagement = profile.role === "management";
  const [schedule, dateSettings] = await Promise.all([
    fetchScheduleData(),
    getDateSettings(supabase),
  ]);

  // Build date settings map
  const settingsMap = new Map(
    dateSettings.map((ds: { date: string; detail_level: string }) => [
      ds.date,
      ds.detail_level as DetailLevel,
    ])
  );

  if (isManagement) {
    const [assignmentsRaw, epos, travelLegsRaw] = await Promise.all([
      getAllAssignmentsWithProfiles(supabase),
      getAllEpos(supabase, profile.id),
      getTravelLegs(supabase),
    ]);

    // Group assignments by date
    const assignmentsByDate = new Map<
      string,
      { id: string; fullName: string; email: string }[]
    >();
    for (const a of assignmentsRaw) {
      const epoInfo = a.profiles as { id: string; full_name: string; email: string } | null;
      if (!epoInfo) continue;
      const existing = assignmentsByDate.get(a.date) ?? [];
      existing.push({
        id: epoInfo.id,
        fullName: epoInfo.full_name,
        email: epoInfo.email,
      });
      assignmentsByDate.set(a.date, existing);
    }

    const travelLegsByDate = new Map<string, TravelLeg>(
      travelLegsRaw.map((tl: { date: string; action: string; location: string; time: string; companion: string; companion_pre_position_flight: string; teak_flight: string; companion_return_flight: string }) => [
        tl.date,
        {
          date: tl.date,
          action: tl.action as TravelLeg["action"],
          location: tl.location,
          time: tl.time,
          companion: tl.companion,
          companionPrePositionFlight: tl.companion_pre_position_flight,
          teakFlight: tl.teak_flight,
          companionReturnFlight: tl.companion_return_flight,
        },
      ])
    );

    const entries: DashboardEntry[] = schedule
      .filter((s) => s.date >= today)
      .map((s) => ({
        ...s,
        detailLevel: settingsMap.get(s.date) ?? "single",
        assignedEpos: assignmentsByDate.get(s.date) ?? [],
        isThisWeek: isThisWeek(s.date),
        isNextWeek: isNextWeek(s.date),
        travelLeg: travelLegsByDate.get(s.date),
      }));

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
      />
    );
  }

  // EPO view: full schedule with assigned dates info + travel details
  const [assignmentsRaw, myAssignments, travelLegsRaw] = await Promise.all([
    getAllAssignmentsWithProfiles(supabase),
    getAssignmentsForUser(supabase, profile.id),
    getTravelLegs(supabase),
  ]);

  const travelLegsByDate = new Map<string, TravelLeg>(
    travelLegsRaw.map((tl: { date: string; action: string; location: string; time: string; companion: string; companion_pre_position_flight: string; teak_flight: string; companion_return_flight: string }) => [
      tl.date,
      {
        date: tl.date,
        action: tl.action as TravelLeg["action"],
        location: tl.location,
        time: tl.time,
        companion: tl.companion,
        companionPrePositionFlight: tl.companion_pre_position_flight,
        teakFlight: tl.teak_flight,
        companionReturnFlight: tl.companion_return_flight,
      },
    ])
  );

  const assignedDates = myAssignments.map((a: { date: string }) => a.date);
  const assignedDateSet = new Set(assignedDates);

  // Group all assignments by date (same logic as management)
  const assignmentsByDate = new Map<
    string,
    { id: string; fullName: string; email: string }[]
  >();
  for (const a of assignmentsRaw) {
    const epoInfo = a.profiles as { id: string; full_name: string; email: string } | null;
    if (!epoInfo) continue;
    const existing = assignmentsByDate.get(a.date) ?? [];
    existing.push({
      id: epoInfo.id,
      fullName: epoInfo.full_name,
      email: epoInfo.email,
    });
    assignmentsByDate.set(a.date, existing);
  }

  const entries: DashboardEntry[] = schedule.map((s) => ({
    ...s,
    detailLevel: settingsMap.get(s.date) ?? "single",
    assignedEpos: assignmentsByDate.get(s.date) ?? [],
    isPast: s.date < today,
    isThisWeek: isThisWeek(s.date),
    isNextWeek: isNextWeek(s.date),
    // Only attach travelLeg when this EPO is assigned to this date.
    travelLeg: assignedDateSet.has(s.date)
      ? travelLegsByDate.get(s.date)
      : undefined,
  }));

  return (
    <EpoDashboard
      entries={entries}
      assignedDates={assignedDates}
      userName={profile.fullName}
      todayISO={today}
      tomorrowISO={tomorrow}
    />
  );
}
