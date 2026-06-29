import { describe, expect, test } from "bun:test";
import type { sheets_v4 } from "googleapis";
import { isShaded, parseScheduleRows } from "./google-sheets";

/** Build a sheet row with a DATE (col A) and ROW_ID (col S) value. */
function dataRow(date: string, rowId: string): sheets_v4.Schema$RowData {
  const values: sheets_v4.Schema$CellData[] = new Array(19).fill({});
  values[0] = { formattedValue: date };
  values[18] = { formattedValue: rowId };
  return { values };
}

const headerRow = (label: string): sheets_v4.Schema$RowData => ({
  values: [{ formattedValue: label }],
});

function cell(
  backgroundColor?: sheets_v4.Schema$Color
): sheets_v4.Schema$CellData {
  return backgroundColor
    ? { effectiveFormat: { backgroundColor } }
    : { effectiveFormat: {} };
}

describe("isShaded", () => {
  test("undefined cell → not shaded", () => {
    expect(isShaded(undefined)).toBe(false);
  });

  test("no effectiveFormat → not shaded", () => {
    expect(isShaded({})).toBe(false);
  });

  test("no backgroundColor → not shaded", () => {
    expect(isShaded(cell())).toBe(false);
  });

  test("white fill (default no-fill) → not shaded", () => {
    expect(isShaded(cell({ red: 1, green: 1, blue: 1 }))).toBe(false);
  });

  test("green fill → shaded", () => {
    expect(isShaded(cell({ red: 0, green: 1, blue: 0 }))).toBe(true);
  });

  test("yellow fill → shaded", () => {
    expect(isShaded(cell({ red: 1, green: 1, blue: 0 }))).toBe(true);
  });

  test("light gray fill → shaded", () => {
    expect(isShaded(cell({ red: 0.9, green: 0.9, blue: 0.9 }))).toBe(true);
  });
});

describe("parseScheduleRows", () => {
  test("includes the first data row when the sheet has a single header row", () => {
    // Regression: the sheet's header shrank from 2 rows to 1, and the old
    // fixed HEADER_ROWS=2 skip ate the first real data row (today's card).
    const entries = parseScheduleRows([
      headerRow("Date"),
      dataRow("Jun-28", "id-today"),
      dataRow("Jun-29", "id-tomorrow"),
    ]);
    expect(entries.map((e) => e.rowId)).toEqual(["id-today", "id-tomorrow"]);
    expect(entries[0].date).toMatch(/-06-28$/);
  });

  test("drops rows without a valid date or without a ROW_ID", () => {
    const entries = parseScheduleRows([
      headerRow("Date"), // no date, no rowId
      dataRow("Jun-28", ""), // valid date but missing ROW_ID
      headerRow("Subtotal"), // junk row
      dataRow("Jun-30", "keep"),
    ]);
    expect(entries.map((e) => e.rowId)).toEqual(["keep"]);
  });

  test("still tolerates a 2-row header (guards filter both)", () => {
    const entries = parseScheduleRows([
      headerRow("Master Schedule"),
      headerRow("Date"),
      dataRow("Jul-1", "x"),
    ]);
    expect(entries.map((e) => e.rowId)).toEqual(["x"]);
  });
});
