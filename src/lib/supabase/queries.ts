import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/types/schedule";

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
