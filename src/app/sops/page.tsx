// src/app/sops/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile, getSops } from "@/lib/supabase/queries";
import { AppHeader } from "@/components/app-header";
import { SopsPageClient } from "./sops-page-client";

export default async function SopsPage() {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile) redirect("/login");

  const sops = await getSops(supabase);

  // Resolve uploader display names. RLS lets EPOs read management profiles
  // by id, so this works for both roles.
  const uploaderIds = Array.from(new Set(sops.map((s) => s.uploadedBy)));
  const uploaders =
    uploaderIds.length === 0
      ? []
      : ((
          await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", uploaderIds)
        ).data ?? []);
  const uploadersById: Record<string, string> = {};
  for (const u of uploaders as { id: string; full_name: string | null }[]) {
    uploadersById[u.id] = u.full_name ?? "";
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <AppHeader
        userName={profile.role === "management" ? undefined : profile.fullName}
      />
      <SopsPageClient
        sops={sops}
        isManagement={profile.role === "management"}
        uploadersById={uploadersById}
      />
    </div>
  );
}
