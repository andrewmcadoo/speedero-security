import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardSnapshot, DashboardEntry, Profile } from "@/types/schedule";

interface ProfileRow {
  id: string;
  email: string;
  full_name: string | null;
  role: "epo" | "management";
  created_at: string;
}

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name ?? "",
    role: row.role,
    createdAt: row.created_at,
  };
}

export async function getProfile(
  supabase: SupabaseClient
): Promise<Profile | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (data) return toProfile(data as ProfileRow);

  // Profile row missing (trigger may have failed on first login).
  // Create it now as a fallback.
  const { data: newProfile } = await supabase
    .from("profiles")
    .upsert({
      id: user.id,
      email: user.email ?? user.user_metadata?.email ?? "",
      full_name:
        user.user_metadata?.full_name ?? user.user_metadata?.name ?? "",
      role: "epo",
    })
    .select()
    .single();

  return newProfile ? toProfile(newProfile as ProfileRow) : null;
}

export async function getAssignmentsForUser(
  supabase: SupabaseClient,
  userId: string
) {
  const { data } = await supabase
    .from("assignments")
    .select("*")
    .eq("epo_id", userId);
  return data ?? [];
}

export async function getAllAssignmentsWithProfiles(
  supabase: SupabaseClient
) {
  const { data } = await supabase
    .from("assignments")
    .select("*, profiles:epo_id(id, full_name, email)");
  return data ?? [];
}

export async function getDateSettings(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("date_settings")
    .select("date, detail_level");
  if (error) {
    console.error("getDateSettings failed:", error.message, error.code, error.details, error.hint);
    return [];
  }
  return data ?? [];
}

export async function getAllEpos(
  supabase: SupabaseClient,
  includeSelfId?: string
) {
  // Returns all EPOs, plus the given profile id if provided. This lets a
  // management user self-assign without exposing other managers in the
  // assignment dropdown.
  const filter = includeSelfId
    ? `role.eq.epo,id.eq.${includeSelfId}`
    : `role.eq.epo`;
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .or(filter)
    .order("full_name");
  return data ?? [];
}

export async function getTravelLegs(supabase: SupabaseClient) {
  const { data } = await supabase.from("travel_legs").select("*");
  return data ?? [];
}

interface CardSnapshotRow {
  date: string;
  payload: DashboardEntry;
  frozen_at: string;
  frozen_by: "cron" | "lazy" | "manual";
}

function toCardSnapshot(row: CardSnapshotRow): CardSnapshot {
  return {
    date: row.date,
    payload: row.payload,
    frozenAt: row.frozen_at,
    frozenBy: row.frozen_by,
  };
}

/**
 * Returns the set of dates (within the input list) that already have a
 * snapshot row. Used by both the cron and the lazy backfill to skip
 * already-frozen dates.
 */
export async function getSnapshotDates(
  supabase: SupabaseClient,
  dates: string[]
): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  const { data, error } = await supabase
    .from("card_snapshots")
    .select("date")
    .in("date", dates);
  if (error) {
    console.error("getSnapshotDates failed:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r: { date: string }) => r.date));
}

/**
 * Returns all snapshots whose date is in [start, end] inclusive, ordered
 * by date ascending.
 */
export async function getSnapshotsBetween(
  supabase: SupabaseClient,
  start: string,
  end: string
): Promise<CardSnapshot[]> {
  const { data, error } = await supabase
    .from("card_snapshots")
    .select("date, payload, frozen_at, frozen_by")
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: true });
  if (error) {
    console.error("getSnapshotsBetween failed:", error.message);
    return [];
  }
  return (data ?? []).map((row) => toCardSnapshot(row as CardSnapshotRow));
}

/**
 * Insert a snapshot. Never overwrites — if a snapshot for `date` already
 * exists, this is a no-op (returns false). Returns true on insert.
 */
export async function upsertSnapshot(
  supabase: SupabaseClient,
  args: { date: string; payload: DashboardEntry; frozenBy: "cron" | "lazy" | "manual" }
): Promise<boolean> {
  const { error } = await supabase
    .from("card_snapshots")
    .insert({
      date: args.date,
      payload: args.payload,
      frozen_by: args.frozenBy,
    });
  if (error) {
    // Unique-constraint violation = "already snapshotted" = expected.
    if (error.code === "23505") return false;
    console.error("upsertSnapshot failed:", error.message, error.code);
    return false;
  }
  return true;
}
