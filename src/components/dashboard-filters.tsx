"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { DateRangeControl } from "./date-range-control";
import type { DateRange } from "@/lib/dashboard/range";
import { nextFilterSearch, readFilterFromSearch } from "@/lib/dashboard/filter-url";

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
}: {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filters?: FilterDef[];
  range: DateRange;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const activeFilter = readFilterFromSearch(params.toString());
  const hasCustomRange =
    params.has("start") || params.has("end") || params.has("date");

  function handlePillClick(value: FilterOption) {
    const qs = nextFilterSearch(params.toString(), value);
    const url = `${pathname}${qs ? "?" + qs : ""}`;
    if (hasCustomRange) {
      // Need a server re-run to drop the custom range params and fetch the
      // default range; replaceState alone wouldn't refresh the `range` prop.
      router.push(url);
    } else {
      // Pill ↔ pill: shallow URL update keeps server components dormant.
      window.history.replaceState(null, "", url);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex gap-1.5">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => handlePillClick(f.value)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              !hasCustomRange && activeFilter === f.value
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
