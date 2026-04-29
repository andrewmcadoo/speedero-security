import { afterEach, describe, expect, test } from "bun:test";
import { _assignEpoForTest } from "./actions";

// _assignEpoForTest is the testable inner function: it takes the (date, epoId,
// supabaseFactory, now) and returns the action's outcome. The exported `assignEpo`
// wraps it with the real createClient + new Date().

describe("assignEpo guard", () => {
  const originalTz = process.env.APP_TIMEZONE;

  afterEach(() => {
    if (originalTz === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = originalTz;
  });

  test("returns ok=false for a past date and never touches supabase", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    let called = false;
    const result = await _assignEpoForTest(
      "2026-04-27",
      "epo-uuid",
      () => {
        called = true;
        throw new Error("supabase factory must not be called for past dates");
      },
      now
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("2026-04-27");
    expect(called).toBe(false);
  });

  test("calls supabase for a today/future date", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    let inserted: Record<string, unknown> | null = null;
    const result = await _assignEpoForTest(
      "2026-04-28",
      "epo-uuid",
      () => ({
        auth: { getUser: async () => ({ data: { user: { id: "mgr-uuid" } } }) },
        from: () => ({
          insert: async (row: Record<string, unknown>) => {
            inserted = row;
            return { error: null };
          },
        }),
      }),
      now
    );
    expect(result.ok).toBe(true);
    expect(inserted).toEqual({
      date: "2026-04-28",
      epo_id: "epo-uuid",
      assigned_by: "mgr-uuid",
    });
  });
});
