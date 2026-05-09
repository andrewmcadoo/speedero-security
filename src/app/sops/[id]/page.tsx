// src/app/sops/[id]/page.tsx
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile, getSopById } from "@/lib/supabase/queries";
import { createSignedSopUrl } from "@/lib/sops/storage";
import { audienceLabel } from "@/lib/sops/audit";
import { AppHeader } from "@/components/app-header";
import { SopViewer } from "@/components/sop-viewer";

export default async function SopViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile) redirect("/login");

  const sop = await getSopById(supabase, id);
  if (!sop) notFound();

  const pdfUrl = await createSignedSopUrl(supabase, sop.storagePathPdf);
  if (!pdfUrl) notFound();

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <AppHeader
        userName={profile.role === "management" ? undefined : profile.fullName}
      />
      <div className="space-y-3 p-3">
        <header className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold text-gray-100">{sop.title}</h1>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            {profile.role === "management" && (
              <span
                className={
                  sop.audience === "shared"
                    ? "rounded bg-emerald-900/60 px-1.5 py-0.5 uppercase text-emerald-200"
                    : "rounded bg-amber-900/60 px-1.5 py-0.5 uppercase text-amber-200"
                }
              >
                {audienceLabel(sop.audience)}
              </span>
            )}
            <span>Updated {new Date(sop.updatedAt).toLocaleString()}</span>
          </div>
          {sop.description && (
            <p className="text-sm text-gray-300">{sop.description}</p>
          )}
        </header>
        <SopViewer pdfUrl={pdfUrl} />
      </div>
    </div>
  );
}
