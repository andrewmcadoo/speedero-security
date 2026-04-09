"use client";

export type FilterOption = "all" | "unassigned" | "my-assignments" | "this-week" | "next-week" | "past-assignments";

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
  active,
  onChange,
  searchQuery,
  onSearchChange,
  filters = DEFAULT_FILTERS,
}: {
  active: FilterOption;
  onChange: (filter: FilterOption) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filters?: FilterDef[];
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex gap-1.5">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => onChange(f.value)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              active === f.value
                ? "bg-blue-900/60 text-blue-400"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <input
        type="text"
        placeholder="Search..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        className="rounded-md bg-gray-800 px-3 py-1.5 text-xs text-gray-300 placeholder-gray-500 outline-none ring-1 ring-gray-700 focus:ring-gray-500"
      />
    </div>
  );
}
