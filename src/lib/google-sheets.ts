import { google, type sheets_v4 } from "googleapis";
import type { ScheduleEntry, TravelLeg } from "@/types/schedule";
import { buildTravelLegsMap } from "./teak-airline-legs";

// Column indices (0-based) matching the master sheet layout
const COL = {
  DATE: 0,
  DAY: 1,
  CONFIRMED: 2,
  TEAK_NIGHT: 3,
  TEAK_TRANSITIONS: 4,
  ACTIVITY: 5,
  NIGHT_LOCATION: 6,
  CO_PILOT: 7,
  AIRLINE_FLT: 8,
  DEP_AIRPORT: 9,
  DEP_FBO: 10,
  DEP_TIME: 11,
  ARR_AIRPORT: 12,
  ARR_FBO: 13,
  ARR_TIME: 14,
  INTL_PAX: 15,
  GROUND_TRANSPORT: 16,
  LODGING: 17,
  COMMENTS: 18,
  ROW_ID: 19,
} as const;

const HEADER_ROWS = 2; // Sheet has a 2-row header

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(
        /\\n/g,
        "\n"
      ),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

/**
 * Parse "Mar-27" style dates into ISO format.
 * Infers the current year; if the date appears to be far in the past
 * (>6 months ago), assumes next year.
 */
function parseSheetDate(raw: string): string | null {
  const cleaned = raw.trim();
  if (!cleaned) return null;

  const match = cleaned.match(
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{1,2})$/i
  );
  if (!match) return null;

  const monthNames: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  const month = monthNames[match[1].toLowerCase()];
  const day = parseInt(match[2], 10);
  const now = new Date();
  let year = now.getFullYear();

  const candidate = new Date(year, month, day);
  // If the date is more than 6 months in the past, assume next year
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  if (candidate < sixMonthsAgo) {
    year++;
  }

  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

/** Extract display string from a grid data cell. */
function cellValue(
  cellData: sheets_v4.Schema$CellData | undefined
): string {
  // Prefer formattedValue (display string, e.g. "Mar-27" for dates)
  if (cellData?.formattedValue) return cellData.formattedValue.trim();
  if (!cellData?.effectiveValue) return "";
  const ev = cellData.effectiveValue;
  return (
    ev.stringValue ??
    ev.formulaValue ??
    (ev.numberValue !== undefined ? String(ev.numberValue) : "")
  ).trim();
}

/** Check if a cell's background color is green. */
function isGreenBackground(
  cellData: sheets_v4.Schema$CellData | undefined
): boolean {
  const bg = cellData?.effectiveFormat?.backgroundColor;
  if (!bg) return false;
  const r = bg.red ?? 0;
  const g = bg.green ?? 0;
  const b = bg.blue ?? 0;
  // Green-shaded: green channel dominant over red and blue
  return g > 0.5 && r < 0.85 && g > r && g > b;
}

/** Check if a cell's background color is yellow/orange. */
function isYellowBackground(
  cellData: sheets_v4.Schema$CellData | undefined
): boolean {
  const bg = cellData?.effectiveFormat?.backgroundColor;
  if (!bg) return false;
  const r = bg.red ?? 0;
  const g = bg.green ?? 0;
  const b = bg.blue ?? 0;
  // Yellow: both red and green high, blue low
  return r > 0.7 && g > 0.7 && b < 0.5;
}

function parseConfirmation(
  cellData: sheets_v4.Schema$CellData | undefined
): ScheduleEntry["confirmationStatus"] {
  // First check cell background color (primary method in this sheet)
  if (isGreenBackground(cellData)) return "confirmed";
  if (isYellowBackground(cellData)) return "pending";

  // Fallback: check text content
  const text = cellValue(cellData);
  if (!text) return "unconfirmed";
  const lower = text.toLowerCase();
  if (lower === "pending" || lower === "p") return "pending";
  return "confirmed";
}

function rowDataToEntry(
  rowData: sheets_v4.Schema$RowData
): ScheduleEntry | null {
  const cells = rowData.values ?? [];
  const date = parseSheetDate(cellValue(cells[COL.DATE]));
  if (!date) return null;

  const rowId = cellValue(cells[COL.ROW_ID]);
  if (!rowId) return null;

  return {
    date,
    dayOfWeek: cellValue(cells[COL.DAY]),
    confirmationStatus: parseConfirmation(cells[COL.CONFIRMED]),
    teakNight: isGreenBackground(cells[COL.TEAK_NIGHT]),
    activity: cellValue(cells[COL.ACTIVITY]),
    location: cellValue(cells[COL.NIGHT_LOCATION]),
    transitions: cellValue(cells[COL.TEAK_TRANSITIONS]),
    coPilot: cellValue(cells[COL.CO_PILOT]),
    flightInfo: cellValue(cells[COL.AIRLINE_FLT]),
    departure: {
      airport: cellValue(cells[COL.DEP_AIRPORT]),
      fbo: cellValue(cells[COL.DEP_FBO]),
      time: cellValue(cells[COL.DEP_TIME]),
    },
    arrival: {
      airport: cellValue(cells[COL.ARR_AIRPORT]),
      fbo: cellValue(cells[COL.ARR_FBO]),
      time: cellValue(cells[COL.ARR_TIME]),
    },
    internationalPax: cellValue(cells[COL.INTL_PAX]),
    groundTransport: cellValue(cells[COL.GROUND_TRANSPORT]),
    lodging: cellValue(cells[COL.LODGING]),
    comments: cellValue(cells[COL.COMMENTS]),
    rowId,
  };
}

export async function fetchSchedule(): Promise<ScheduleEntry[]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.get({
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
    includeGridData: true,
    ranges: ["A:T"],
    fields:
      "sheets.data.rowData.values.formattedValue,sheets.data.rowData.values.effectiveValue,sheets.data.rowData.values.effectiveFormat.backgroundColor",
  });

  const sheetData = response.data.sheets?.[0]?.data?.[0];
  if (!sheetData?.rowData) return [];

  const rows = sheetData.rowData;
  const entries: ScheduleEntry[] = [];
  for (let i = HEADER_ROWS; i < rows.length; i++) {
    const entry = rowDataToEntry(rows[i]);
    if (entry) entries.push(entry);
  }

  return entries;
}

const TEAK_AIRLINE_LEGS_RANGE = "Teak Airline Legs!A:H";

/**
 * Fetch rows from the "Teak Airline Legs" sheet and return a map
 * keyed by ISO date. Returns an empty map on any error (travel details
 * are a non-critical enhancement — dashboard must still render without
 * them).
 */
export async function fetchTravelLegs(): Promise<Map<string, TravelLeg>> {
  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
      range: TEAK_AIRLINE_LEGS_RANGE,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const rows = (response.data.values ?? []) as string[][];
    return buildTravelLegsMap(rows);
  } catch (error) {
    console.error("fetchTravelLegs failed:", error);
    return new Map();
  }
}
