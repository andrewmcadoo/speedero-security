"use client";

import { useMemo, useState } from "react";
import type { DashboardEntry } from "@/types/schedule";
import { SignOutButton } from "@/components/sign-out-button";
import { DateHeader } from "@/components/date-header";
import { ScheduleDetailCard } from "@/components/schedule-detail-card";
import {
  DashboardFilters,
  type FilterOption,
} from "@/components/dashboard-filters";

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
}: {
  entries: DashboardEntry[];
  assignedDates: string[];
  userName: string;
  todayISO: string;
  tomorrowISO: string;
}) {
  const [filter, setFilter] = useState<FilterOption>("all");
  const [search, setSearch] = useState("");

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
          <h1 className="text-xl font-bold">Schedule</h1>
          <p className="text-sm text-gray-400">
            {userName} &middot; {entries.length} assigned dates
          </p>
        </div>
        <SignOutButton />
      </header>

      <div className="mb-4">
        <DashboardFilters
          active={filter}
          onChange={setFilter}
          searchQuery={search}
          onSearchChange={setSearch}
          filters={EPO_FILTERS}
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
