import { afterEach, describe, expect, test } from "bun:test";
import { formatDateHeader, getAnchorDates } from "./schedule-utils";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

describe("getAnchorDates", () => {
  const originalTz = process.env.APP_TIMEZONE;

  afterEach(() => {
    if (originalTz === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = originalTz;
  });

  test("returns today and tomorrow as ISO YYYY-MM-DD strings", () => {
    const { today, tomorrow, timezone } = getAnchorDates();
    expect(today).toMatch(ISO_DATE_RE);
    expect(tomorrow).toMatch(ISO_DATE_RE);
    expect(typeof timezone).toBe("string");
    expect(timezone.length).toBeGreaterThan(0);
  });

  test("honors APP_TIMEZONE env override", () => {
    // Pick a moment where UTC and Tokyo disagree on the calendar day:
    // 2026-04-14 22:00 UTC is 2026-04-15 07:00 Asia/Tokyo.
    const ref = new Date("2026-04-14T22:00:00Z");

    process.env.APP_TIMEZONE = "Asia/Tokyo";
    const tokyo = getAnchorDates(ref);
    expect(tokyo.timezone).toBe("Asia/Tokyo");
    expect(tokyo.today).toBe("2026-04-15");
    expect(tokyo.tomorrow).toBe("2026-04-16");

    process.env.APP_TIMEZONE = "UTC";
    const utc = getAnchorDates(ref);
    expect(utc.timezone).toBe("UTC");
    expect(utc.today).toBe("2026-04-14");
    expect(utc.tomorrow).toBe("2026-04-15");

    // Unset → falls back to default (America/Los_Angeles).
    delete process.env.APP_TIMEZONE;
    const def = getAnchorDates(ref);
    expect(def.timezone).toBe("America/Los_Angeles");
  });

  test("bug scenario: 04:48 UTC on Apr 14 is still Apr 13 in LA", () => {
    // 2026-04-14T04:48:00Z = 2026-04-13 21:48 PDT.
    // Management view used to compute today="2026-04-14" (server UTC),
    // EPO view rendered client-side so saw today="2026-04-13".
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const { today, tomorrow } = getAnchorDates(
      new Date("2026-04-14T04:48:00Z")
    );
    expect(today).toBe("2026-04-13");
    expect(tomorrow).toBe("2026-04-14");
  });

  test("tomorrow is one calendar day after today (non-DST reference)", () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const { today, tomorrow } = getAnchorDates(
      new Date("2026-03-14T10:00:00Z")
    );
    // 2026-03-14 10:00 UTC = 2026-03-14 03:00 PDT.
    expect(today).toBe("2026-03-14");
    expect(tomorrow).toBe("2026-03-15");
  });

  test("DST spring-forward boundary (PST→PDT on 2026-03-08)", () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const { today, tomorrow } = getAnchorDates(
      new Date("2026-03-08T09:00:00Z")
    );
    // 2026-03-08 09:00 UTC is 01:00 PST (before the 02:00 spring-forward).
    expect(today).toBe("2026-03-08");
    expect(tomorrow).toBe("2026-03-09");
  });
});

describe("formatDateHeader", () => {
  test("TODAY branch includes the calendar date", () => {
    expect(formatDateHeader("2026-04-14", "2026-04-14", "2026-04-15")).toBe(
      "TODAY · April 14"
    );
  });

  test("TOMORROW branch includes the calendar date", () => {
    expect(formatDateHeader("2026-04-15", "2026-04-14", "2026-04-15")).toBe(
      "TOMORROW · April 15"
    );
  });

  test("other dates render WEEKDAY · Month Day", () => {
    // 2026-04-20 is a Monday.
    expect(formatDateHeader("2026-04-20", "2026-04-14", "2026-04-15")).toBe(
      "MONDAY · April 20"
    );
  });
});
