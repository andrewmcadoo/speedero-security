"use client";

import { useMemo, useState } from "react";
import type { DashboardEntry } from "@/types/schedule";
import { SignOutButton } from "@/components/sign-out-button";
import { ReportBugButton } from "@/components/report-bug-button";
import { DateHeader } from "@/components/date-header";
import { ManagementCard } from "@/components/management-card";
import {
  DashboardFilters,
  type FilterOption,
} from "@/components/dashboard-filters";
import Link from "next/link";

export function ManagementDashboard({
  entries,
  epos,
  profileId,
  todayISO,
  tomorrowISO,
}: {
  entries: DashboardEntry[];
  epos: { id: string; fullName: string; email: string }[];
  profileId: string;
  todayISO: string;
  tomorrowISO: string;
}) {
  const [filter, setFilter] = useState<FilterOption>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let result = entries;

    switch (filter) {
      case "unassigned":
        result = result.filter((e) => e.assignedEpos.length === 0);
        break;
      case "this-week":
        result = result.filter((e) => e.isThisWeek);
        break;
      case "next-week":
        result = result.filter((e) => e.isNextWeek);
        break;
    }

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.activity.toLowerCase().includes(q) ||
          e.location.toLowerCase().includes(q)
      );
    }

    return result;
  }, [entries, filter, search]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Speedero Security</h1>
          <p className="text-sm text-gray-400">Management Dashboard</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/users"
            className="rounded-md px-3 py-1.5 text-xs text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
          >
            Manage Users
          </Link>
          <ReportBugButton />
          <SignOutButton />
        </div>
      </header>

      <div className="mb-4">
        <DashboardFilters
          active={filter}
          onChange={setFilter}
          searchQuery={search}
          onSearchChange={setSearch}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="mt-20 text-center">
          <p className="text-lg text-gray-500">
            {entries.length === 0
              ? "No schedule data"
              : "No matching entries"}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            {entries.length === 0
              ? "Check your Google Sheets connection."
              : "Try adjusting your filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((entry) => (
            <div key={entry.date} className="space-y-2">
              <DateHeader
                dateStr={entry.date}
                status={entry.confirmationStatus}
                todayISO={todayISO}
                tomorrowISO={tomorrowISO}
              />
              <ManagementCard
                entry={entry}
                allEpos={epos}
                profileId={profileId}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
