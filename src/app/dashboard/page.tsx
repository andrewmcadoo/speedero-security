import { createClient } from "@/lib/supabase/server";
import { getProfile, getAssignmentsForUser, getDateSettings, getAllAssignmentsWithProfiles, getAllEpos } from "@/lib/supabase/queries";
import { fetchSchedule } from "@/lib/google-sheets";
import type { ScheduleEntry, DashboardEntry, DetailLevel } from "@/types/schedule";
import { isThisWeek, isNextWeek } from "@/lib/schedule-utils";
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

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
    const [assignmentsRaw, epos] = await Promise.all([
      getAllAssignmentsWithProfiles(supabase),
      getAllEpos(supabase),
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

    const entries: DashboardEntry[] = schedule
      .filter((s) => s.date >= today)
      .map((s) => ({
        ...s,
        detailLevel: settingsMap.get(s.date) ?? "single",
        assignedEpos: assignmentsByDate.get(s.date) ?? [],
        isThisWeek: isThisWeek(s.date),
        isNextWeek: isNextWeek(s.date),
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
      />
    );
  }

  // EPO view: full schedule with assigned dates info
  const [assignmentsRaw, myAssignments] = await Promise.all([
    getAllAssignmentsWithProfiles(supabase),
    getAssignmentsForUser(supabase, profile.id),
  ]);

  const assignedDates = myAssignments.map((a: { date: string }) => a.date);

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
  }));

  return (
    <EpoDashboard
      entries={entries}
      assignedDates={assignedDates}
      userName={profile.fullName}
    />
  );
}
