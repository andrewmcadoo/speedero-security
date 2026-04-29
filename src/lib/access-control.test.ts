import { afterEach, describe, expect, test } from "bun:test";
import { assertNotPast, PastDateWriteError } from "./access-control";

describe("assertNotPast", () => {
  const originalTz = process.env.APP_TIMEZONE;

  afterEach(() => {
    if (originalTz === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = originalTz;
  });

  test("throws PastDateWriteError when date is strictly before today", () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z"); // 08:00 PT
    expect(() => assertNotPast("2026-04-27", now)).toThrow(PastDateWriteError);
  });

  test("does not throw for today's date", () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z"); // 08:00 PT, today=2026-04-28
    expect(() => assertNotPast("2026-04-28", now)).not.toThrow();
  });

  test("does not throw for a future date", () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    expect(() => assertNotPast("2026-05-01", now)).not.toThrow();
  });

  test("respects APP_TIMEZONE for the today boundary", () => {
    // 2026-04-29T04:00 UTC = 2026-04-28 21:00 PT, but 2026-04-29 13:00 Tokyo.
    // In LA, today=2026-04-28 → assertNotPast('2026-04-28') passes.
    // In Tokyo, today=2026-04-29 → assertNotPast('2026-04-28') throws.
    const now = new Date("2026-04-29T04:00:00Z");

    process.env.APP_TIMEZONE = "America/Los_Angeles";
    expect(() => assertNotPast("2026-04-28", now)).not.toThrow();

    process.env.APP_TIMEZONE = "Asia/Tokyo";
    expect(() => assertNotPast("2026-04-28", now)).toThrow(PastDateWriteError);
  });

  test("error message names the date for debugging", () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    try {
      assertNotPast("2026-04-27", now);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PastDateWriteError);
      expect((err as Error).message).toContain("2026-04-27");
    }
  });
});
