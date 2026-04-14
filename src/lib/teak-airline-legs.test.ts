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
