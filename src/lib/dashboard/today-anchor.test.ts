import { describe, expect, test } from "bun:test";
import { findAnchorDate } from "./today-anchor";

type E = { date: string };

describe("findAnchorDate", () => {
  test("returns null for empty input", () => {
    expect(findAnchorDate([], "2026-04-29")).toEqual({ date: null, isToday: false });
  });

  test("returns today when today is in the set", () => {
    const entries: E[] = [
      { date: "2026-04-27" },
      { date: "2026-04-28" },
      { date: "2026-04-29" },
      { date: "2026-04-30" },
    ];
    expect(findAnchorDate(entries, "2026-04-29")).toEqual({
      date: "2026-04-29",
      isToday: true,
    });
  });

  test("returns the next-upcoming date when today is missing", () => {
    const entries: E[] = [
      { date: "2026-04-27" },
      { date: "2026-04-28" },
      { date: "2026-05-02" },
      { date: "2026-05-04" },
    ];
    expect(findAnchorDate(entries, "2026-04-29")).toEqual({
      date: "2026-05-02",
      isToday: false,
    });
  });

  test("returns null when all entries are in the past", () => {
    const entries: E[] = [
      { date: "2026-04-26" },
      { date: "2026-04-27" },
      { date: "2026-04-28" },
    ];
    expect(findAnchorDate(entries, "2026-04-29")).toEqual({ date: null, isToday: false });
  });

  test("works on unsorted input", () => {
    const entries: E[] = [
      { date: "2026-05-04" },
      { date: "2026-04-27" },
      { date: "2026-05-02" },
      { date: "2026-04-28" },
    ];
    // today is missing, smallest >= today is 2026-05-02
    expect(findAnchorDate(entries, "2026-04-29")).toEqual({
      date: "2026-05-02",
      isToday: false,
    });
  });

  test("today match wins over earlier matches in array order", () => {
    // Even if a future date appears before today in the array, today should win.
    const entries: E[] = [
      { date: "2026-05-10" },
      { date: "2026-04-29" },
      { date: "2026-05-02" },
    ];
    expect(findAnchorDate(entries, "2026-04-29")).toEqual({
      date: "2026-04-29",
      isToday: true,
    });
  });
});
