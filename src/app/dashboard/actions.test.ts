import { afterEach, describe, expect, test } from "bun:test";
import { _assignEpoForTest, _setDetailLevelForTest, _unassignEpoForTest } from "./actions";

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

describe("unassignEpo guard", () => {
  const originalTz = process.env.APP_TIMEZONE;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = originalTz;
  });

  test("returns ok=false for past dates without touching supabase", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    let called = false;
    const result = await _unassignEpoForTest(
      "2026-04-27",
      "epo-uuid",
      () => {
        called = true;
        throw new Error("must not be called");
      },
      now
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  test("issues a delete().eq('date').eq('epo_id') for valid dates", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    const calls: { date?: string; epoId?: string } = {};
    const result = await _unassignEpoForTest(
      "2026-04-28",
      "epo-uuid",
      () => ({
        auth: { getUser: async () => ({ data: { user: { id: "mgr-uuid" } } }) },
        from: () => ({
          insert: async () => ({ error: null }),
          delete: () => ({
            eq: (col: string, val: string) => {
              if (col === "date") calls.date = val;
              if (col === "epo_id") calls.epoId = val;
              return {
                eq: (col2: string, val2: string) => {
                  if (col2 === "date") calls.date = val2;
                  if (col2 === "epo_id") calls.epoId = val2;
                  return Promise.resolve({ error: null });
                },
              };
            },
          }),
        }),
      }),
      now
    );
    expect(result.ok).toBe(true);
    expect(calls).toEqual({ date: "2026-04-28", epoId: "epo-uuid" });
  });
});

describe("setDetailLevel guard", () => {
  const originalTz = process.env.APP_TIMEZONE;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = originalTz;
  });

  test("rejects past dates without touching supabase", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    let called = false;
    const result = await _setDetailLevelForTest(
      "2026-04-27",
      "single",
      () => {
        called = true;
        throw new Error("must not be called");
      },
      now
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  test("upserts on date conflict for valid dates", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    let upsertedRow: Record<string, unknown> | null = null;
    let conflictKey: string | undefined;
    const result = await _setDetailLevelForTest(
      "2026-04-28",
      "dual",
      () => ({
        auth: { getUser: async () => ({ data: { user: { id: "mgr-uuid" } } }) },
        from: () => ({
          insert: async () => ({ error: null }),
          upsert: async (row: Record<string, unknown>, opts?: unknown) => {
            upsertedRow = row;
            conflictKey = (opts as { onConflict?: string } | undefined)?.onConflict;
            return { error: null };
          },
        }),
      }),
      now
    );
    expect(result.ok).toBe(true);
    expect(conflictKey).toBe("date");
    expect(upsertedRow).toMatchObject({
      date: "2026-04-28",
      detail_level: "dual",
      updated_by: "mgr-uuid",
    });
  });
});
