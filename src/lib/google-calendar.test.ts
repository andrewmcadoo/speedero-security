import { describe, expect, test, afterEach, beforeEach } from "bun:test";
import { stripTransitionPrefix, parseCalendarEvents, getConfiguredPrincipals, mergeAndSortTransitions, type CalendarApiEvent } from "./google-calendar";
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

describe("getConfiguredPrincipals", () => {
  const originalGreg = process.env.GOOGLE_CALENDAR_ID_GREG;
  const originalKrista = process.env.GOOGLE_CALENDAR_ID_KRISTA;
  let warnings: unknown[][] = [];
  let originalWarn: typeof console.warn;

  beforeEach(() => {
    delete process.env.GOOGLE_CALENDAR_ID_GREG;
    delete process.env.GOOGLE_CALENDAR_ID_KRISTA;
    warnings = [];
    originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
  });

  afterEach(() => {
    if (originalGreg !== undefined) process.env.GOOGLE_CALENDAR_ID_GREG = originalGreg;
    else delete process.env.GOOGLE_CALENDAR_ID_GREG;
    if (originalKrista !== undefined) process.env.GOOGLE_CALENDAR_ID_KRISTA = originalKrista;
    else delete process.env.GOOGLE_CALENDAR_ID_KRISTA;
    console.warn = originalWarn;
  });

  test("returns both principals when both env vars are set", () => {
    process.env.GOOGLE_CALENDAR_ID_GREG = "greg@example.com";
    process.env.GOOGLE_CALENDAR_ID_KRISTA = "krista@example.com";
    expect(getConfiguredPrincipals()).toEqual([
      { person: "greg", calendarIds: ["greg@example.com"] },
      { person: "krista", calendarIds: ["krista@example.com"] },
    ]);
    expect(warnings).toEqual([]);
  });

  test("skips and warns about a missing principal", () => {
    process.env.GOOGLE_CALENDAR_ID_GREG = "greg@example.com";
    // Krista's env var unset
    const result = getConfiguredPrincipals();
    expect(result).toEqual([{ person: "greg", calendarIds: ["greg@example.com"] }]);
    expect(warnings.length).toBe(1);
    expect(String(warnings[0][0])).toContain("krista");
  });

  test("skips and warns when env var is empty string", () => {
    process.env.GOOGLE_CALENDAR_ID_GREG = "";
    process.env.GOOGLE_CALENDAR_ID_KRISTA = "krista@example.com";
    const result = getConfiguredPrincipals();
    expect(result).toEqual([{ person: "krista", calendarIds: ["krista@example.com"] }]);
    expect(warnings.length).toBe(1);
    expect(String(warnings[0][0])).toContain("greg");
  });

  test("returns empty array when neither is configured", () => {
    expect(getConfiguredPrincipals()).toEqual([]);
    expect(warnings.length).toBe(2);
  });

  test("splits comma-separated calendar IDs into a list", () => {
    process.env.GOOGLE_CALENDAR_ID_GREG = "greg@example.com";
    process.env.GOOGLE_CALENDAR_ID_KRISTA = "k1@example.com,k2@example.com,k3@example.com";
    expect(getConfiguredPrincipals()).toEqual([
      { person: "greg", calendarIds: ["greg@example.com"] },
      { person: "krista", calendarIds: ["k1@example.com", "k2@example.com", "k3@example.com"] },
    ]);
    expect(warnings).toEqual([]);
  });

  test("trims whitespace around comma-separated values and drops empty segments", () => {
    process.env.GOOGLE_CALENDAR_ID_KRISTA = " k1@example.com , , k2@example.com ,";
    const result = getConfiguredPrincipals();
    expect(result.find((p) => p.person === "krista")?.calendarIds).toEqual([
      "k1@example.com",
      "k2@example.com",
    ]);
  });

  test("skips and warns when env var is comma/whitespace-only", () => {
    process.env.GOOGLE_CALENDAR_ID_KRISTA = " , , ,";
    const result = getConfiguredPrincipals();
    expect(result.find((p) => p.person === "krista")).toBeUndefined();
    expect(warnings.some((w) => String(w[0]).includes("krista"))).toBe(true);
  });
});

describe("mergeAndSortTransitions", () => {
  const t = (person: "greg" | "krista", eventId: string, startsAt: string): Transition => ({
    person,
    title: `${eventId}-title`,
    startsAt,
    tz: "America/Los_Angeles",
    eventId,
  });

  test("returns empty array for empty input", () => {
    expect(mergeAndSortTransitions([])).toEqual([]);
  });

  test("sorts ascending by startsAt", () => {
    const result = mergeAndSortTransitions([
      t("greg", "a", "2026-04-30T14:00:00-07:00"),
      t("greg", "b", "2026-04-30T09:00:00-07:00"),
      t("greg", "c", "2026-04-30T11:00:00-07:00"),
    ]);
    expect(result.map((x) => x.eventId)).toEqual(["b", "c", "a"]);
  });

  test("dedupes (person, eventId) keeping first occurrence", () => {
    const first = t("krista", "evt_x", "2026-04-30T11:30:00-07:00");
    const dup = { ...first, title: "later-copy" };
    const result = mergeAndSortTransitions([first, dup]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(first); // identity check — first kept
  });

  test("does NOT dedupe across different persons even with same eventId", () => {
    const result = mergeAndSortTransitions([
      t("greg", "shared_evt", "2026-04-30T09:00:00-07:00"),
      t("krista", "shared_evt", "2026-04-30T10:00:00-07:00"),
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((x) => x.person)).toEqual(["greg", "krista"]);
  });

  test("interleaves persons by time after dedup", () => {
    const result = mergeAndSortTransitions([
      t("greg", "g1", "2026-04-30T11:00:00-07:00"),
      t("krista", "k1", "2026-04-30T09:00:00-07:00"),
      t("greg", "g2", "2026-04-30T14:00:00-07:00"),
      t("krista", "k1", "2026-04-30T09:00:00-07:00"), // dup of k1 (e.g. same event on two of Krista's calendars)
    ]);
    expect(result.map((x) => x.eventId)).toEqual(["k1", "g1", "g2"]);
  });
});
