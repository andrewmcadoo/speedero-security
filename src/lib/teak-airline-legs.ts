const MONTH_NAMES: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse "27-Mar" / "1-Apr" style dates into ISO (YYYY-MM-DD).
 * Mirrors google-sheets.ts#parseSheetDate but with inverted tokens
 * (DD-MMM instead of MMM-DD).
 *
 * Year inference: pick the year that keeps the date within ~6 months
 * of `now` in either direction. Ties (exactly 6 months) prefer the
 * forward direction. Pass `now` explicitly for deterministic tests.
 */
export function parseTeakDate(
  raw: string,
  now: Date = new Date()
): string | null {
  const cleaned = raw.trim();
  if (!cleaned) return null;

  const match = cleaned.match(/^(\d{1,2})-([A-Za-z]{3})$/);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const month = MONTH_NAMES[match[2].toLowerCase()];
  if (month === undefined) return null;
  if (day < 1 || day > 31) return null;

  // Month-based distance from `now` to the target month/day, where
  // forward distance (0..12) wraps around the calendar. If the forward
  // distance exceeds 6 months, the date is closer in the past → use
  // previous year. If it equals exactly 6 months, prefer forward.
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth();
  const monthDiff = (month - nowMonth + 12) % 12; // 0..11 (forward)
  // If monthDiff is in 0..6 inclusive, target is "ahead or <= 6 months
  // behind via wrap"; stay at current year. Otherwise (7..11) the
  // target is closer in the past, so use previous year.
  const chosenYear = monthDiff <= 6 ? nowYear : nowYear - 1;

  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${chosenYear}-${m}-${d}`;
}
