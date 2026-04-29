import { describe, expect, test } from "bun:test";
import { selectMissingDatesForCron } from "./freeze";

describe("selectMissingDatesForCron", () => {
  test("returns the prior 7 days minus already-frozen", () => {
    const today = "2026-04-28";
    const existing = new Set(["2026-04-25", "2026-04-26"]);
    const result = selectMissingDatesForCron(today, existing);
    expect(result).toEqual([
      "2026-04-21",
      "2026-04-22",
      "2026-04-23",
      "2026-04-24",
      "2026-04-27",
    ]);
  });

  test("returns empty when all 7 days are already frozen", () => {
    const today = "2026-04-28";
    const existing = new Set([
      "2026-04-21",
      "2026-04-22",
      "2026-04-23",
      "2026-04-24",
      "2026-04-25",
      "2026-04-26",
      "2026-04-27",
    ]);
    expect(selectMissingDatesForCron(today, existing)).toEqual([]);
  });

  test("never includes today or future dates", () => {
    const today = "2026-04-28";
    const result = selectMissingDatesForCron(today, new Set());
    expect(result).not.toContain("2026-04-28");
    expect(result).not.toContain("2026-04-29");
  });
});
