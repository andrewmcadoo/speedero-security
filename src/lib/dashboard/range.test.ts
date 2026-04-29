import { describe, expect, test } from "bun:test";
import { parseRangeFromSearchParams } from "./range";

describe("parseRangeFromSearchParams", () => {
  test("returns management default (today..today+30) when nothing provided", () => {
    const range = parseRangeFromSearchParams({}, { today: "2026-04-28", role: "management" });
    expect(range).toEqual({ start: "2026-04-28", end: "2026-05-28" });
  });

  test("returns EPO default (today-7..today+30) when nothing provided", () => {
    const range = parseRangeFromSearchParams({}, { today: "2026-04-28", role: "epo" });
    expect(range).toEqual({ start: "2026-04-21", end: "2026-05-28" });
  });

  test("uses both ?start= and ?end= when both valid", () => {
    const range = parseRangeFromSearchParams(
      { start: "2026-03-01", end: "2026-03-15" },
      { today: "2026-04-28", role: "management" }
    );
    expect(range).toEqual({ start: "2026-03-01", end: "2026-03-15" });
  });

  test("falls back to default when ?start= is malformed", () => {
    const range = parseRangeFromSearchParams(
      { start: "not-a-date", end: "2026-03-15" },
      { today: "2026-04-28", role: "management" }
    );
    expect(range.start).toBe("2026-04-28");
  });

  test("swaps when start > end", () => {
    const range = parseRangeFromSearchParams(
      { start: "2026-04-30", end: "2026-04-20" },
      { today: "2026-04-28", role: "management" }
    );
    expect(range).toEqual({ start: "2026-04-20", end: "2026-04-30" });
  });

  test("treats single ?date= as a 1-day range", () => {
    const range = parseRangeFromSearchParams(
      { date: "2026-04-28" },
      { today: "2026-04-28", role: "management" }
    );
    expect(range).toEqual({ start: "2026-04-28", end: "2026-04-28" });
  });
});
