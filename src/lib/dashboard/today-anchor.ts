/**
 * Resolve the entry that should receive the scroll anchor on dashboard load.
 *
 * - If today is in the set, anchor today and tell the caller it IS today
 *   (so the banner will render when today scrolls off-screen).
 * - Otherwise, anchor the next-upcoming entry (smallest date >= todayISO)
 *   and tell the caller it is NOT today (banner stays hidden — there is no
 *   "today" to jump back to).
 * - If nothing in the set is today or future, return null (no anchoring).
 *
 * Input is not assumed sorted. EPO filter passes can produce out-of-order
 * sets relative to the original assembly.
 */
export function findAnchorDate<T extends { date: string }>(
  entries: ReadonlyArray<T>,
  todayISO: string,
): { date: string | null; isToday: boolean } {
  let nextUpcoming: string | null = null;
  for (const e of entries) {
    if (e.date === todayISO) {
      return { date: todayISO, isToday: true };
    }
    if (e.date > todayISO && (nextUpcoming === null || e.date < nextUpcoming)) {
      nextUpcoming = e.date;
    }
  }
  return { date: nextUpcoming, isToday: false };
}
