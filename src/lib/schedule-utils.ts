import type { ScheduleEntry } from "@/types/schedule";

const PAST_DAYS = 7;
const FUTURE_DAYS = 30;

/**
 * Filter schedule entries to a rolling window around today.
 */
export function filterRollingWindow(
  entries: ScheduleEntry[]
): ScheduleEntry[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const pastCutoff = new Date(now);
  pastCutoff.setDate(pastCutoff.getDate() - PAST_DAYS);

  const futureCutoff = new Date(now);
  futureCutoff.setDate(futureCutoff.getDate() + FUTURE_DAYS);

  return entries.filter((entry) => {
    const entryDate = new Date(entry.date + "T00:00:00");
    return entryDate >= pastCutoff && entryDate <= futureCutoff;
  });
}

/**
 * Check if a date string is today.
 */
export function isToday(dateStr: string): boolean {
  const today = new Date();
  const date = new Date(dateStr + "T00:00:00");
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

/**
 * Format a date string for display: "TODAY", "TOMORROW", or "WEEKDAY · Month Day"
 */
export function formatDateHeader(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.getTime() === today.getTime()) return "TODAY";
  if (date.getTime() === tomorrow.getTime()) return "TOMORROW";

  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  const month = date.toLocaleDateString("en-US", { month: "long" });
  const day = date.getDate();
  return `${weekday.toUpperCase()} · ${month} ${day}`;
}

/**
 * Check if a date is today or in the future.
 */
export function isTodayOrFuture(dateStr: string): boolean {
  const date = new Date(dateStr + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return date >= now;
}

/**
 * Check if a date is in the past (before today).
 */
export function isPast(dateStr: string): boolean {
  const date = new Date(dateStr + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return date < now;
}

/**
 * Rolling 7-day window: today through today+6.
 */
export function isThisWeek(dateStr: string): boolean {
  const date = new Date(dateStr + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setDate(end.getDate() + 6);
  return date >= now && date <= end;
}

/**
 * Rolling next-week window: today+7 through today+13.
 */
export function isNextWeek(dateStr: string): boolean {
  const date = new Date(dateStr + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const start = new Date(now);
  start.setDate(start.getDate() + 7);
  const end = new Date(now);
  end.setDate(end.getDate() + 13);
  return date >= start && date <= end;
}
