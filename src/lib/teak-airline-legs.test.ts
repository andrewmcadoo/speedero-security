import { describe, expect, test } from "bun:test";
import { parseTeakDate } from "./teak-airline-legs";

describe("parseTeakDate", () => {
  test("parses DD-MMM format with zero-padded output", () => {
    const result = parseTeakDate("27-Mar");
    expect(result).toMatch(/^\d{4}-03-27$/);
  });

  test("parses single-digit day", () => {
    const result = parseTeakDate("1-Apr");
    expect(result).toMatch(/^\d{4}-04-01$/);
  });

  test("case-insensitive month abbreviation", () => {
    expect(parseTeakDate("5-JUN")).toMatch(/^\d{4}-06-05$/);
    expect(parseTeakDate("5-jun")).toMatch(/^\d{4}-06-05$/);
  });

  test("returns null for empty string", () => {
    expect(parseTeakDate("")).toBeNull();
    expect(parseTeakDate("   ")).toBeNull();
  });

  test("returns null for malformed input", () => {
    expect(parseTeakDate("Mar-27")).toBeNull();
    expect(parseTeakDate("27/03")).toBeNull();
    expect(parseTeakDate("March 27")).toBeNull();
    expect(parseTeakDate("27-Foo")).toBeNull();
  });

  test("bumps year when date is more than 6 months in the past", () => {
    const refDate = new Date(2026, 0, 1);
    expect(parseTeakDate("15-Jul", refDate)).toBe("2026-07-15");
    expect(parseTeakDate("15-Oct", refDate)).toBe("2025-10-15");
  });
});

import { rowToTravelLeg } from "./teak-airline-legs";

describe("rowToTravelLeg", () => {
  const refDate = new Date(2026, 3, 1); // 2026-04-01

  test("maps a clean row into a TravelLeg", () => {
    const row = [
      "27-Mar",
      "Pick up",
      "L.O.",
      "14:45",
      "Hayk",
      "AS562 BUR-PDX 7:00-9:31",
      "AS559 PDX-BUR 17:57-20:19",
      "—",
    ];
    expect(rowToTravelLeg(row, refDate)).toEqual({
      date: "2026-03-27",
      action: "Pick up",
      location: "L.O.",
      time: "14:45",
      companion: "Hayk",
      companionPrePositionFlight: "AS562 BUR-PDX 7:00-9:31",
      teakFlight: "AS559 PDX-BUR 17:57-20:19",
      companionReturnFlight: "—",
    });
  });

  test("returns null when date column is empty (separator row)", () => {
    const row = ["", "", "", "", "", "", "", ""];
    expect(rowToTravelLeg(row, refDate)).toBeNull();
  });

  test("returns null when date is malformed", () => {
    const row = ["not-a-date", "Pick up", "L.O.", "", "", "", "", ""];
    expect(rowToTravelLeg(row, refDate)).toBeNull();
  });

  test("normalizes action variants and typos", () => {
    const makeRow = (action: string) =>
      ["9-Mar", action, "L.O.", "14:45", "Hayk", "", "", ""];
    expect(rowToTravelLeg(makeRow("Pick up"), refDate)?.action).toBe("Pick up");
    expect(rowToTravelLeg(makeRow("Pickup"), refDate)?.action).toBe("Pick up");
    expect(rowToTravelLeg(makeRow("Pickip"), refDate)?.action).toBe("Pick up");
    expect(rowToTravelLeg(makeRow("Drop off"), refDate)?.action).toBe("Drop off");
    expect(rowToTravelLeg(makeRow("Drop Off"), refDate)?.action).toBe("Drop off");
    expect(rowToTravelLeg(makeRow(""), refDate)?.action).toBe("Unknown");
    expect(rowToTravelLeg(makeRow("—"), refDate)?.action).toBe("Unknown");
    expect(rowToTravelLeg(makeRow("weird"), refDate)?.action).toBe("Unknown");
  });

  test("trims trailing whitespace on all string fields", () => {
    const row = [
      "16-Jan",
      "Pickup",
      "L.O. ",
      "14:45",
      "Hayk ",
      "",
      "AS559 PDX-BUR 17:55-20:09",
      "",
    ];
    const leg = rowToTravelLeg(row, refDate);
    expect(leg?.location).toBe("L.O.");
    expect(leg?.companion).toBe("Hayk");
    expect(leg?.teakFlight).toBe("AS559 PDX-BUR 17:55-20:09");
  });

  test("preserves blank (empty string) fields as-is — no em-dash coercion", () => {
    const row = ["14-Jun", "", "", "", "", "AS 1397 LAX-PDX 6:07-8:30pm", "", ""];
    const leg = rowToTravelLeg(row, refDate);
    expect(leg?.action).toBe("Unknown");
    expect(leg?.location).toBe("");
    expect(leg?.time).toBe("");
    expect(leg?.companionPrePositionFlight).toBe("AS 1397 LAX-PDX 6:07-8:30pm");
    expect(leg?.teakFlight).toBe("");
    expect(leg?.companionReturnFlight).toBe("");
  });

  test("handles short rows (missing trailing cells) gracefully", () => {
    const row = ["9-Mar", "Pick up", "L.O.", "14:45"];
    const leg = rowToTravelLeg(row, refDate);
    expect(leg).not.toBeNull();
    expect(leg?.companion).toBe("");
    expect(leg?.teakFlight).toBe("");
  });
});

import { buildTravelLegsMap } from "./teak-airline-legs";

describe("buildTravelLegsMap", () => {
  const refDate = new Date(2026, 3, 1);

  test("skips the header row and separator rows", () => {
    const rows = [
      ["", "Pick up or Drop off", "Location", "Time", "Companion",
        "Companion Pre Position Flight", "Teak Flight", "Companion Return Flight"],
      ["27-Mar", "Pick up", "L.O.", "14:45", "Hayk",
        "AS562 BUR-PDX 7:00-9:31", "AS559 PDX-BUR 17:57-20:19", "—"],
      ["", "", "", "", "", "", "", ""],
      ["1-Apr", "Pick up", "BH Airbnb", "BH Airbnb", "Hayk",
        "—", "AS1355 LAX-PDX 11:03-13:37", "DL2459 PDX-LAX 19:58-22:34"],
    ];
    const map = buildTravelLegsMap(rows, refDate);
    expect(map.size).toBe(2);
    expect(map.get("2026-03-27")?.action).toBe("Pick up");
    expect(map.get("2026-04-01")?.location).toBe("BH Airbnb");
  });

  test("returns empty map for empty input", () => {
    expect(buildTravelLegsMap([], refDate).size).toBe(0);
  });

  test("later rows with the same date override earlier rows", () => {
    const rows = [
      ["", "Pick up or Drop off", "Location", "Time", "Companion", "", "", ""],
      ["9-Mar", "Pick up", "Old", "10:00", "Hayk", "", "", ""],
      ["9-Mar", "Drop off", "New", "11:00", "Hayk", "", "", ""],
    ];
    const map = buildTravelLegsMap(rows, refDate);
    expect(map.size).toBe(1);
    expect(map.get("2026-03-09")?.location).toBe("New");
  });
});
