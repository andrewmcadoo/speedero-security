import { describe, expect, test } from "bun:test";
import {
  assessHeartbeatStaleness,
  WATCHDOG_MAX_AGE_HOURS,
} from "./heartbeat";

describe("assessHeartbeatStaleness", () => {
  const now = new Date("2026-06-29T12:00:00.000Z");

  test("fresh heartbeat (age < threshold) is not stale", () => {
    const lastSuccessAt = new Date("2026-06-29T10:00:00.000Z").toISOString(); // 2h ago
    const r = assessHeartbeatStaleness({
      lastSuccessAt,
      now,
      thresholdHours: WATCHDOG_MAX_AGE_HOURS,
    });
    expect(r.stale).toBe(false);
    expect(r.ageHours).toBeCloseTo(2, 5);
  });

  test("exactly at threshold is not stale (strict >)", () => {
    const lastSuccessAt = new Date(
      now.getTime() - WATCHDOG_MAX_AGE_HOURS * 3_600_000
    ).toISOString();
    const r = assessHeartbeatStaleness({
      lastSuccessAt,
      now,
      thresholdHours: WATCHDOG_MAX_AGE_HOURS,
    });
    expect(r.stale).toBe(false);
    expect(r.ageHours).toBeCloseTo(WATCHDOG_MAX_AGE_HOURS, 5);
  });

  test("beyond threshold is stale", () => {
    const lastSuccessAt = new Date(
      now.getTime() - (WATCHDOG_MAX_AGE_HOURS + 1) * 3_600_000
    ).toISOString();
    const r = assessHeartbeatStaleness({
      lastSuccessAt,
      now,
      thresholdHours: WATCHDOG_MAX_AGE_HOURS,
    });
    expect(r.stale).toBe(true);
  });

  test("null lastSuccessAt is stale with null ageHours", () => {
    const r = assessHeartbeatStaleness({
      lastSuccessAt: null,
      now,
      thresholdHours: WATCHDOG_MAX_AGE_HOURS,
    });
    expect(r.stale).toBe(true);
    expect(r.ageHours).toBeNull();
  });

  test("an unparseable timestamp is stale with null ageHours (no false-fresh)", () => {
    const r = assessHeartbeatStaleness({
      lastSuccessAt: "not-a-date",
      now,
      thresholdHours: WATCHDOG_MAX_AGE_HOURS,
    });
    expect(r.stale).toBe(true);
    expect(r.ageHours).toBeNull();
  });

  test("a future heartbeat (clock skew) clamps to age 0 and is fresh", () => {
    const lastSuccessAt = new Date(now.getTime() + 3_600_000).toISOString(); // 1h ahead
    const r = assessHeartbeatStaleness({
      lastSuccessAt,
      now,
      thresholdHours: WATCHDOG_MAX_AGE_HOURS,
    });
    expect(r.stale).toBe(false);
    expect(r.ageHours).toBe(0);
  });

  test("age math: 30h ago against a fixed now yields ageHours ≈ 30", () => {
    const lastSuccessAt = new Date("2026-06-28T06:00:00.000Z").toISOString(); // 30h before now
    const r = assessHeartbeatStaleness({
      lastSuccessAt,
      now,
      thresholdHours: WATCHDOG_MAX_AGE_HOURS,
    });
    expect(r.ageHours).toBeCloseTo(30, 5);
    expect(r.stale).toBe(true);
  });
});

describe("WATCHDOG_MAX_AGE_HOURS", () => {
  test("is 26 (daily cron + ~2h slack)", () => {
    expect(WATCHDOG_MAX_AGE_HOURS).toBe(26);
  });
});
