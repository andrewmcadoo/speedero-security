"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function updatePassword(
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const password = formData.get("password") as string;
  if (!password || password.length < 6) {
    return { error: "Password must be at least 6 characters" };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: error.message };
  }

  // Clear must_change_password flag if set
  if (user.user_metadata?.must_change_password) {
    const admin = createAdminClient();
    await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { must_change_password: null },
    });
  }

  return { success: true };
}
