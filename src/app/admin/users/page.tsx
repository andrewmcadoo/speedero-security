import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/supabase/queries";
import { redirect } from "next/navigation";
import { AddUserForm } from "@/components/add-user-form";
import { UserRow } from "@/components/user-row";
import { AutoRefresh } from "@/components/auto-refresh";
import Link from "next/link";

export default async function AdminUsersPage() {
  const supabase = await createClient();
  const profile = await getProfile(supabase);

  if (!profile || profile.role !== "management") {
    redirect("/dashboard");
  }

  const { data: users } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });

  return (
    <AutoRefresh interval={10000}>
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <header className="mb-6">
        <Link
          href="/dashboard"
          className="mb-2 inline-block text-xs text-gray-500 transition-colors hover:text-gray-300"
        >
          ← Back to Dashboard
        </Link>
        <h1 className="text-xl font-bold">User Management</h1>
        <p className="text-sm text-gray-400">
          {users?.length ?? 0} users
        </p>
      </header>

      <div className="mb-4">
        <AddUserForm />
      </div>

      <div className="space-y-1">
        {(users ?? []).map(
          (user: {
            id: string;
            full_name: string;
            email: string;
            role: "epo" | "management";
          }) => (
            <UserRow
              key={user.id}
              user={user}
              currentUserId={profile.id}
            />
          )
        )}
      </div>
    </div>
    </AutoRefresh>
  );
}
