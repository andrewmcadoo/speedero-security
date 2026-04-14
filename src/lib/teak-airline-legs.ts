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

  // Month-based year inference.
  // Default: use `now`'s year. If the resulting candidate falls more
  // than 6 months in the future, bump back one year; if it falls more
  // than 6 months in the past, bump forward one year.
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth();
  let chosenYear = nowYear;
  if (month > nowMonth) {
    // Target is in the future of the current year.
    const forwardDist = month - nowMonth;
    if (forwardDist > 6) chosenYear = nowYear - 1;
  } else if (month < nowMonth) {
    // Target is in the past of the current year.
    const backwardDist = nowMonth - month;
    if (backwardDist > 6) chosenYear = nowYear + 1;
  }

  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${chosenYear}-${m}-${d}`;
}

import type { TravelLeg } from "@/types/schedule";

function cell(row: readonly string[], idx: number): string {
  return (row[idx] ?? "").trim();
}

function normalizeAction(raw: string): TravelLeg["action"] {
  const lower = raw.trim().toLowerCase();
  if (lower === "pick up" || lower === "pickup" || lower === "pickip") {
    return "Pick up";
  }
  if (lower === "drop off" || lower === "dropoff") {
    return "Drop off";
  }
  return "Unknown";
}

/**
 * Map a single row from the "Teak Airline Legs" sheet into a TravelLeg.
 * Returns null when the date column is empty or malformed (separator rows,
 * trailing empties).
 *
 * Columns (A–H): Date, Action, Location, Time, Companion,
 *   Companion Pre Position Flight, Teak Flight, Companion Return Flight.
 */
export function rowToTravelLeg(
  row: readonly string[],
  now: Date = new Date()
): TravelLeg | null {
  const date = parseTeakDate(cell(row, 0), now);
  if (!date) return null;

  return {
    date,
    action: normalizeAction(cell(row, 1)),
    location: cell(row, 2),
    time: cell(row, 3),
    companion: cell(row, 4),
    companionPrePositionFlight: cell(row, 5),
    teakFlight: cell(row, 6),
    companionReturnFlight: cell(row, 7),
  };
}
