import { describe, expect, test } from "bun:test";
import {
  assessCaptureHealth,
  runPreRolloverSnapshot,
  selectMissingDatesForCron,
  selectUnfrozenPastDates,
} from "./freeze";

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

describe("selectUnfrozenPastDates", () => {
  test("unions mirror + live past dates; drops today/future and already-frozen", () => {
    const today = "2026-06-29";
    const r = selectUnfrozenPastDates(
      today,
      ["2026-06-20", "2026-06-28", "2026-07-01"], // mirror (07-01 future → drop)
      ["2026-06-28", "2026-06-29", "2026-06-25"], // live (06-29 today → drop)
      new Set(["2026-06-28"]) // already frozen
    );
    expect(r).toEqual(["2026-06-20", "2026-06-25"]);
  });

  test("empty when nothing past, or all past dates already frozen", () => {
    expect(selectUnfrozenPastDates("2026-06-29", [], [], new Set())).toEqual([]);
    expect(
      selectUnfrozenPastDates(
        "2026-06-29",
        ["2026-06-28"],
        [],
        new Set(["2026-06-28"])
      )
    ).toEqual([]);
  });
});

describe("assessCaptureHealth", () => {
  test("healthy run produces no issues", () => {
    expect(
      assessCaptureHealth({ liveScheduleCount: 120, unrecoverable: [] })
    ).toEqual([]);
  });

  test("empty sheet fetch is flagged", () => {
    const issues = assessCaptureHealth({
      liveScheduleCount: 0,
      unrecoverable: [],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("0 rows");
  });

  test("unrecoverable dates are flagged and listed", () => {
    const issues = assessCaptureHealth({
      liveScheduleCount: 100,
      unrecoverable: ["2026-06-23", "2026-06-27"],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("2026-06-23");
  });
});

describe("runPreRolloverSnapshot", () => {
  test("is exported as a function", () => {
    // Full integration test would require mocking the entire SupabaseClient
    // surface plus fetchSchedule/fetchTransitions. The export check guards
    // against accidental removal; behavior is covered by manual fire of the
    // /api/snapshot/prerollover endpoint and the lookback cron's tests.
    expect(typeof runPreRolloverSnapshot).toBe("function");
  });
});
