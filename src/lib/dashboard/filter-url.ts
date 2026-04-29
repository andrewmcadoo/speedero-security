import type { FilterOption } from "@/components/dashboard-filters";

const VALID_FILTERS: FilterOption[] = [
  "all",
  "unassigned",
  "my-assignments",
  "this-week",
  "next-week",
  "past-assignments",
];

/**
 * Read the active filter from a URLSearchParams query string.
 *
 * Mirrors the rule in DashboardFilters: when a custom range param is present
 * (start/end/date), the filter pill is treated as inactive — return "all" so
 * the dashboard renders the full range without an extra predicate.
 */
export function readFilterFromSearch(search: string): FilterOption {
  const params = new URLSearchParams(search);
  if (params.has("start") || params.has("end") || params.has("date")) {
    return "all";
  }
  const raw = params.get("filter");
  if (raw && (VALID_FILTERS as string[]).includes(raw)) {
    return raw as FilterOption;
  }
  return "all";
}

/**
 * Produce the next URLSearchParams string when the user picks a filter pill.
 * Clears any range params (pills are mutually exclusive with custom ranges)
 * and omits the filter param entirely when the choice is the default ("all").
 */
export function nextFilterSearch(search: string, filter: FilterOption): string {
  const params = new URLSearchParams(search);
  params.delete("start");
  params.delete("end");
  params.delete("date");
  if (filter === "all") {
    params.delete("filter");
  } else {
    params.set("filter", filter);
  }
  return params.toString();
}
