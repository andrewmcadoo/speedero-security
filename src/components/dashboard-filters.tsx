"use client";

import { DateRangeControl } from "./date-range-control";
import type { DateRange } from "@/lib/dashboard/range";

export type FilterOption =
  | "all"
  | "unassigned"
  | "my-assignments"
  | "this-week"
  | "next-week"
  | "past-assignments";

interface FilterDef {
  value: FilterOption;
  label: string;
}

const DEFAULT_FILTERS: FilterDef[] = [
  { value: "all", label: "All Dates" },
  { value: "unassigned", label: "Unassigned" },
  { value: "this-week", label: "This Week" },
  { value: "next-week", label: "Next Week" },
];

export function DashboardFilters({
  searchQuery,
  onSearchChange,
  filters = DEFAULT_FILTERS,
  range,
  activeFilter,
  onFilterChange,
}: {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filters?: FilterDef[];
  range: DateRange;
  activeFilter: FilterOption | null;
  onFilterChange: (value: FilterOption) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex gap-1.5">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => onFilterChange(f.value)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              activeFilter === f.value
                ? "bg-blue-900/60 text-blue-400"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <DateRangeControl range={range} />
        <input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="rounded-md bg-gray-800 px-3 py-1.5 text-xs text-gray-300 placeholder-gray-500 outline-none ring-1 ring-gray-700 focus:ring-gray-500"
        />
      </div>
    </div>
  );
}
