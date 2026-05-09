// src/app/sops/audit/page.tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  getProfile,
  getSopAuditLog,
  listManagementProfiles,
  type AuditFilters,
} from "@/lib/supabase/queries";
import { createSignedSopUrl } from "@/lib/sops/storage";
import { AppHeader } from "@/components/app-header";
import { SopAuditFilters } from "@/components/sop-audit-filters";
import { SopAuditTable } from "@/components/sop-audit-table";
import type { SopAuditAction } from "@/types/sops";

const PAGE_SIZE = 50;

function parseAuditActions(actionsParam: string | undefined): SopAuditAction[] {
  if (!actionsParam) return [];
  const valid: SopAuditAction[] = [
    "upload",
    "replace_file",
    "edit_metadata",
    "visibility_change",
    "delete",
  ];
  return actionsParam
    .split(",")
    .filter((a): a is SopAuditAction =>
      (valid as string[]).includes(a)
    );
}

export default async function SopAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile) redirect("/login");
  if (profile.role !== "management") redirect("/sops");

  const params = await searchParams;
  const get = (k: string) =>
    typeof params[k] === "string" ? (params[k] as string) : undefined;

  const page = Math.max(0, parseInt(get("page") ?? "0", 10) || 0);
  const filters: AuditFilters = {
    sopId: get("sop_id"),
    actorId: get("actor"),
    actions: parseAuditActions(get("actions")),
    titleQuery: get("q"),
    startDate: get("start"),
    endDate: get("end"),
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

  const [{ entries, totalCount }, mgmtProfiles] = await Promise.all([
    getSopAuditLog(supabase, filters),
    listManagementProfiles(supabase),
  ]);

  // Pre-sign URLs for any file-bearing rows on this page.
  const paths = Array.from(
    new Set(
      entries
        .flatMap((e) => [e.newStoragePath, e.supersededStoragePath])
        .filter((p): p is string => p !== null)
    )
  );
  const signedEntries = await Promise.all(
    paths.map(async (p) => [p, await createSignedSopUrl(supabase, p)] as const)
  );
  const signedUrlByPath: Record<string, string | null> = {};
  for (const [p, url] of signedEntries) signedUrlByPath[p] = url;

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const baseQuery = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string" && k !== "page") baseQuery.set(k, v);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <AppHeader />
      <div className="space-y-3 p-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-100">SOP Audit Log</h1>
          <Link
            href="/sops"
            className="rounded-md px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800"
          >
            ← Back to SOPs
          </Link>
        </div>
        <SopAuditFilters managementProfiles={mgmtProfiles} />
        <SopAuditTable entries={entries} signedUrlByPath={signedUrlByPath} />
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            Page {page + 1} of {totalPages} ({totalCount} entries)
          </span>
          <div className="flex gap-2">
            <PageLink baseQuery={baseQuery} page={page - 1} disabled={page === 0}>
              Previous
            </PageLink>
            <PageLink
              baseQuery={baseQuery}
              page={page + 1}
              disabled={page + 1 >= totalPages}
            >
              Next
            </PageLink>
          </div>
        </div>
      </div>
    </div>
  );
}

function PageLink({
  baseQuery,
  page,
  disabled,
  children,
}: {
  baseQuery: URLSearchParams;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return <span className="rounded-md px-3 py-1 text-gray-700">{children}</span>;
  }
  const q = new URLSearchParams(baseQuery);
  q.set("page", String(page));
  return (
    <Link
      href={`/sops/audit?${q.toString()}`}
      className="rounded-md px-3 py-1 text-blue-300 hover:bg-gray-800 hover:text-blue-200"
    >
      {children}
    </Link>
  );
}
