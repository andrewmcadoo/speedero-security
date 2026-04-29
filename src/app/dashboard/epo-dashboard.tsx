"use client";

import { useEffect, useMemo, useState } from "react";
import type { DashboardEntry } from "@/types/schedule";
import { SignOutButton } from "@/components/sign-out-button";
import { ReportBugButton } from "@/components/report-bug-button";
import { DateHeader } from "@/components/date-header";
import { ScheduleDetailCard } from "@/components/schedule-detail-card";
import {
  DashboardFilters,
  type FilterOption,
} from "@/components/dashboard-filters";
import { nextFilterSearch, readFilterFromSearch } from "@/lib/dashboard/filter-url";

const EPO_FILTERS = [
  { value: "all" as const, label: "My Assignments" },
  { value: "this-week" as const, label: "This Week" },
  { value: "next-week" as const, label: "Next Week" },
  { value: "past-assignments" as const, label: "Past Assignments" },
];

export function EpoDashboard({
  entries,
  assignedDates,
  userName,
  todayISO,
  tomorrowISO,
  range,
}: {
  entries: DashboardEntry[];
  assignedDates: string[];
  userName: string;
  todayISO: string;
  tomorrowISO: string;
  range: { start: string; end: string };
}) {
  const firstName = (userName ?? "").trim().split(/\s+/)[0] || "";
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterOption>("all");

  // Read initial filter from URL once on mount. After mount, local state is
  // the source of truth; URL sync goes the other way via replaceState.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: defer window.location read to client after hydration.
    setFilter(readFilterFromSearch(window.location.search));
  }, []);

  function handleFilterChange(next: FilterOption) {
    setFilter(next);
    const qs = nextFilterSearch(window.location.search, next);
    const url = `${window.location.pathname}${qs ? "?" + qs : ""}`;
    // Shallow URL update — Next.js 16 routes window.history.replaceState
    // through its internal store so useSearchParams stays in sync, but
    // server components do NOT re-run.
    window.history.replaceState(null, "", url);
  }

  const filtered = useMemo(() => {
    let result = entries.filter((e) => assignedDates.includes(e.date));

    switch (filter) {
      case "all":
        result = result.filter((e) => !e.isPast);
        break;
      case "this-week":
        result = result.filter((e) => e.isThisWeek);
        break;
      case "next-week":
        result = result.filter((e) => e.isNextWeek);
        break;
      case "past-assignments":
        result = result.filter((e) => e.isPast);
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
  }, [entries, filter, search, assignedDates]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Speedero Security</h1>
          <p className="text-sm text-gray-400">
            {firstName ? `${firstName}'s Assignment Schedule` : "Assignment Schedule"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ReportBugButton />
          <SignOutButton />
        </div>
      </header>

      <div className="mb-4">
        <DashboardFilters
          searchQuery={search}
          onSearchChange={setSearch}
          filters={EPO_FILTERS}
          range={range}
          activeFilter={filter}
          onFilterChange={handleFilterChange}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="mt-20 text-center">
          <p className="text-lg text-gray-500">
            {entries.length === 0
              ? "No assigned dates"
              : "No matching entries"}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            {entries.length === 0
              ? "Check back later or contact your supervisor."
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
              <ScheduleDetailCard entry={entry} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
