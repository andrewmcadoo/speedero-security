"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/supabase/queries";
import { revalidatePath } from "next/cache";

export async function addUser(
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData
) {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile || profile.role !== "management") {
    return { error: "Unauthorized" };
  }

  const email = (formData.get("email") as string)?.trim();
  const password = (formData.get("password") as string) ?? "";
  const fullName = (formData.get("fullName") as string)?.trim() ?? "";
  const role = formData.get("role") as string;

  if (!email || !email.includes("@")) {
    return { error: "Valid email is required" };
  }
  if (password.length < 6) {
    return { error: "Password must be at least 6 characters" };
  }
  if (role !== "epo" && role !== "management") {
    return { error: "Invalid role" };
  }

  const admin = createAdminClient();
  const { data, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, must_change_password: true },
  });

  if (createError) {
    return { error: createError.message };
  }

  // Ensure profile row exists (trigger may fail silently) and set role
  if (data.user) {
    const { error: upsertError } = await admin
      .from("profiles")
      .upsert({
        id: data.user.id,
        email,
        full_name: fullName,
        role,
      });
    if (upsertError) {
      return {
        error: `User created but profile upsert failed: ${upsertError.message}`,
      };
    }
  }

  revalidatePath("/admin/users");
  return { success: true };
}

export async function editUser(
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData
) {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile || profile.role !== "management") {
    return { error: "Unauthorized" };
  }

  const userId = formData.get("userId") as string;
  const email = (formData.get("email") as string)?.trim();
  const fullName = (formData.get("fullName") as string)?.trim();
  const role = formData.get("role") as string;

  if (!userId) {
    return { error: "User ID is required" };
  }
  if (!email || !email.includes("@")) {
    return { error: "Valid email is required" };
  }
  if (!fullName) {
    return { error: "Full name is required" };
  }
  if (role !== "epo" && role !== "management") {
    return { error: "Invalid role" };
  }

  const admin = createAdminClient();

  // Fetch existing user to preserve metadata (e.g., must_change_password)
  const { data: existingUser, error: fetchError } =
    await admin.auth.admin.getUserById(userId);
  if (fetchError || !existingUser?.user) {
    return { error: "User not found" };
  }

  // Update auth user (email + metadata)
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    email,
    user_metadata: {
      ...existingUser.user.user_metadata,
      full_name: fullName,
    },
  });
  if (updateError) {
    return { error: updateError.message };
  }

  // Update profile row
  const { error: profileError } = await admin
    .from("profiles")
    .update({ email, full_name: fullName, role })
    .eq("id", userId);
  if (profileError) {
    return { error: `Auth updated but profile failed: ${profileError.message}` };
  }

  revalidatePath("/admin/users");
  return { success: true };
}

export async function resetUserPassword(
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData
) {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile || profile.role !== "management") {
    return { error: "Unauthorized" };
  }

  const userId = formData.get("userId") as string;
  const password = formData.get("password") as string;

  if (!userId) {
    return { error: "User ID is required" };
  }
  if (!password || password.length < 6) {
    return { error: "Password must be at least 6 characters" };
  }

  const isSelf = userId === profile.id;

  if (isSelf) {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      return { error: error.message };
    }
  } else {
    const admin = createAdminClient();

    const { data: existingUser, error: fetchError } =
      await admin.auth.admin.getUserById(userId);
    if (fetchError || !existingUser?.user) {
      return { error: "User not found" };
    }

    const { error } = await admin.auth.admin.updateUserById(userId, {
      password,
      user_metadata: {
        ...existingUser.user.user_metadata,
        must_change_password: true,
      },
    });
    if (error) {
      return { error: error.message };
    }
  }

  revalidatePath("/admin/users");
  return { success: true };
}

export async function deleteUser(
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData
) {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile || profile.role !== "management") {
    return { error: "Unauthorized" };
  }

  const userId = formData.get("userId") as string;
  if (!userId) {
    return { error: "User ID is required" };
  }
  if (userId === profile.id) {
    return { error: "Cannot delete your own account" };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/users");
  return { success: true };
}
