import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/types/schedule";

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

  if (data) return data as Profile;

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

  return newProfile as Profile | null;
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
  const { data } = await supabase.from("date_settings").select("*");
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
