import { describe, expect, test } from "bun:test";
import { stripTransitionPrefix, parseCalendarEvents, type CalendarApiEvent } from "./google-calendar";
import type { Transition } from "@/types/schedule";

describe("stripTransitionPrefix", () => {
  test("strips standard 'TT: ' prefix", () => {
    expect(stripTransitionPrefix("TT: Studio")).toBe("Studio");
  });

  test("is case-insensitive", () => {
    expect(stripTransitionPrefix("tt: home")).toBe("home");
    expect(stripTransitionPrefix("Tt: airport")).toBe("airport");
  });

  test("accepts no whitespace after colon", () => {
    expect(stripTransitionPrefix("TT:Studio")).toBe("Studio");
  });

  test("accepts multiple spaces after colon", () => {
    expect(stripTransitionPrefix("TT:   Office")).toBe("Office");
  });

  test("trims trailing whitespace", () => {
    expect(stripTransitionPrefix("TT: Studio   ")).toBe("Studio");
  });

  test("returns null for non-matching titles", () => {
    expect(stripTransitionPrefix("Studio")).toBeNull();
    expect(stripTransitionPrefix("Matt: meeting")).toBeNull(); // contains TT: as substring but not at start
  });

  test("returns null when title is just the prefix with empty body", () => {
    expect(stripTransitionPrefix("TT:")).toBeNull();
    expect(stripTransitionPrefix("TT:   ")).toBeNull();
    expect(stripTransitionPrefix("  TT:  ")).toBeNull();
  });

  test("accepts leading whitespace before prefix", () => {
    expect(stripTransitionPrefix("  TT: Office")).toBe("Office");
  });
});

const baseEvent = (overrides: Partial<CalendarApiEvent>): CalendarApiEvent => ({
  id: "evt_default",
  summary: "TT: Default",
  start: { dateTime: "2026-04-30T09:30:00-07:00", timeZone: "America/Los_Angeles" },
  ...overrides,
});

describe("parseCalendarEvents", () => {
  test("parses a single timed TT: event into a Transition", () => {
    const result = parseCalendarEvents("greg", [
      baseEvent({ id: "evt_1", summary: "TT: Studio" }),
    ]);
    expect(result).toEqual<Transition[]>([
      {
        person: "greg",
        title: "Studio",
        startsAt: "2026-04-30T09:30:00-07:00",
        tz: "America/Los_Angeles",
        eventId: "evt_1",
      },
    ]);
  });

  test("skips all-day events (no dateTime, only date)", () => {
    const result = parseCalendarEvents("greg", [
      { id: "evt_a", summary: "TT: All day", start: { date: "2026-04-30" } },
    ]);
    expect(result).toEqual([]);
  });

  test("skips events whose post-strip title is empty", () => {
    const result = parseCalendarEvents("greg", [
      baseEvent({ id: "evt_b", summary: "TT:" }),
      baseEvent({ id: "evt_c", summary: "TT:   " }),
    ]);
    expect(result).toEqual([]);
  });

  test("skips events without TT: prefix", () => {
    const result = parseCalendarEvents("greg", [
      baseEvent({ id: "evt_d", summary: "Studio" }),
      baseEvent({ id: "evt_e", summary: "Matt: meeting" }),
    ]);
    expect(result).toEqual([]);
  });

  test("falls back to UTC when timeZone is missing", () => {
    const result = parseCalendarEvents("krista", [
      {
        id: "evt_f",
        summary: "TT: Office",
        start: { dateTime: "2026-04-30T09:30:00Z" }, // no timeZone
      },
    ]);
    expect(result[0].tz).toBe("UTC");
  });

  test("preserves the person tag passed in", () => {
    const result = parseCalendarEvents("krista", [
      baseEvent({ id: "evt_g", summary: "TT: Hair" }),
    ]);
    expect(result[0].person).toBe("krista");
  });

  test("skips events missing summary", () => {
    const result = parseCalendarEvents("greg", [
      { id: "evt_h", start: { dateTime: "2026-04-30T09:30:00-07:00", timeZone: "America/Los_Angeles" } },
    ]);
    expect(result).toEqual([]);
  });

  test("skips events missing id", () => {
    const result = parseCalendarEvents("greg", [
      { summary: "TT: Office", start: { dateTime: "2026-04-30T09:30:00-07:00", timeZone: "America/Los_Angeles" } } as CalendarApiEvent,
    ]);
    expect(result).toEqual([]);
  });
});
