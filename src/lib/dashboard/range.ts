import { addDays } from "@/lib/schedule-utils";

export type Role = "epo" | "management";

export interface DateRange {
  start: string;
  end: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function defaultRange(today: string, role: Role): DateRange {
  const start = role === "epo" ? addDays(today, -7) : today;
  return { start, end: addDays(today, 30) };
}

function isValidIsoDate(s: string | undefined): s is string {
  if (!s) return false;
  if (!ISO_DATE_RE.test(s)) return false;
  // Reject "2026-13-01" and similar.
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Defensive parse of the dashboard URL params. Falls back to the role's
 * default range on any garbage input. Swaps when start > end.
 *
 * Supports:
 *   ?start=YYYY-MM-DD&end=YYYY-MM-DD  (range)
 *   ?date=YYYY-MM-DD                  (single-day shorthand; equivalent to start=end)
 */
export function parseRangeFromSearchParams(
  params: Record<string, string | string[] | undefined>,
  ctx: { today: string; role: Role }
): DateRange {
  const get = (key: string): string | undefined => {
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  };

  const date = get("date");
  if (date && isValidIsoDate(date)) {
    return { start: date, end: date };
  }

  const start = get("start");
  const end = get("end");
  const startValid = isValidIsoDate(start);
  const endValid = isValidIsoDate(end);

  if (!startValid && !endValid) return defaultRange(ctx.today, ctx.role);

  const fallback = defaultRange(ctx.today, ctx.role);

  // If the user supplied both bounds, honor them (swap if reversed).
  if (startValid && endValid) {
    let s = start!;
    let e = end!;
    if (s > e) [s, e] = [e, s];
    return { start: s, end: e };
  }

  // Exactly one bound is valid. Combine with the fallback, but if that
  // produces an inverted range, fall back entirely rather than emit garbage.
  const s = startValid ? start! : fallback.start;
  const e = endValid ? end! : fallback.end;
  if (s > e) return fallback;
  return { start: s, end: e };
}
