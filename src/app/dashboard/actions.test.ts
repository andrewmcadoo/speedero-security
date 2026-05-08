import { afterEach, describe, expect, test } from "bun:test";
import {
  _assignEpoForTest,
  _setDetailLevelForTest,
  _setDetailLevelWithNotifyForTest,
  _unassignEpoForTest,
  _createTravelLegForTest,
  _updateTravelLegForTest,
  _deleteTravelLegForTest,
} from "./actions";

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

describe("travel-leg guards", () => {
  const originalTz = process.env.APP_TIMEZONE;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = originalTz;
  });

  test("createTravelLeg rejects past dates", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    const result = await _createTravelLegForTest(
      "2026-04-27",
      "Pick up",
      () => { throw new Error("must not be called"); },
      now
    );
    expect(result.ok).toBe(false);
  });

  test("updateTravelLeg rejects past dates", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    const result = await _updateTravelLegForTest(
      "2026-04-27",
      "Pick up",
      { location: "X" },
      () => { throw new Error("must not be called"); },
      now
    );
    expect(result.ok).toBe(false);
  });

  test("deleteTravelLeg rejects past dates", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    const result = await _deleteTravelLegForTest(
      "2026-04-27",
      "Pick up",
      () => { throw new Error("must not be called"); },
      now
    );
    expect(result.ok).toBe(false);
  });

  test("createTravelLeg inserts a row with date+action+created_by for valid date", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    let inserted: Record<string, unknown> | null = null;
    const result = await _createTravelLegForTest(
      "2026-04-28",
      "Pick up",
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
      action: "Pick up",
      created_by: "mgr-uuid",
    });
  });
});

import type { ScheduleEntry } from "@/types/schedule";
import { EmailNotConfiguredError } from "@/lib/email/resend";

const sampleEntry: ScheduleEntry = {
  date: "2026-04-28",
  dayOfWeek: "Tuesday",
  confirmationStatus: "confirmed",
  teakNight: false,
  activity: "Site visit",
  location: "Reno, NV",
  coPilot: "",
  flightInfo: "",
  departure: { airport: "KVNY", fbo: "Signature", time: "08:30" },
  arrival: { airport: "KRNO", fbo: "Atlantic", time: "10:15" },
  internationalPax: "",
  groundTransport: "",
  lodging: "",
  comments: "",
  rowId: "row-1",
};

interface NotifyMockState {
  upsertedRows: Record<string, unknown>[];
  selectedDates: string[];
  previousLevel: string | null;
  actorRow: { id: string; full_name: string; email: string } | null;
  otherManagers: { id: string; full_name: string; email: string }[];
}

function makeNotifyFactory(state: NotifyMockState) {
  return () => ({
    auth: { getUser: async () => ({ data: { user: { id: "mgr-uuid" } } }) },
    from: (table: string) => {
      if (table === "date_settings") {
        return {
          insert: async () => ({ error: null }),
          upsert: async (row: Record<string, unknown>) => {
            state.upsertedRows.push(row);
            return { error: null };
          },
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => {
                state.selectedDates.push(val);
                return state.previousLevel
                  ? { data: { detail_level: state.previousLevel }, error: null }
                  : { data: null, error: null };
              },
            }),
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: (col1: string, _val1: string) => {
              if (col1 === "id") {
                return {
                  maybeSingle: async () =>
                    state.actorRow
                      ? { data: state.actorRow, error: null }
                      : { data: null, error: null },
                };
              }
              return {
                neq: (_col2: string, _val2: string) => ({
                  data: state.otherManagers,
                  error: null,
                }),
              };
            },
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  });
}

describe("setDetailLevelWithNotify", () => {
  const originalTz = process.env.APP_TIMEZONE;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = originalTz;
  });

  test("notify=false saves without sending email", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    const state: NotifyMockState = {
      upsertedRows: [],
      selectedDates: [],
      previousLevel: "single",
      actorRow: null,
      otherManagers: [],
    };
    let sendCalls = 0;
    const result = await _setDetailLevelWithNotifyForTest(
      "2026-04-28",
      "dual",
      false,
      makeNotifyFactory(state),
      now,
      {
        sendEmail: async () => {
          sendCalls++;
        },
        loadSchedule: async () => [sampleEntry],
        appUrl: "https://test.example",
      }
    );
    expect(result).toEqual({ ok: true });
    expect(state.upsertedRows.length).toBe(1);
    expect(sendCalls).toBe(0);
  });

  test("notify=true sends one email per other manager", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    const state: NotifyMockState = {
      upsertedRows: [],
      selectedDates: [],
      previousLevel: "single",
      actorRow: { id: "mgr-uuid", full_name: "Jane Manager", email: "jane@x" },
      otherManagers: [
        { id: "m2", full_name: "Bob", email: "bob@x" },
        { id: "m3", full_name: "Carol", email: "carol@x" },
      ],
    };
    const sentTo: string[] = [];
    const result = await _setDetailLevelWithNotifyForTest(
      "2026-04-28",
      "dual",
      true,
      makeNotifyFactory(state),
      now,
      {
        sendEmail: async (args) => {
          sentTo.push(args.to);
        },
        loadSchedule: async () => [sampleEntry],
        appUrl: "https://test.example",
      }
    );
    expect(result).toEqual({ ok: true });
    expect(sentTo.sort()).toEqual(["bob@x", "carol@x"]);
  });

  test("save failure short-circuits before email", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    let sendCalls = 0;
    const factory = () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: "mgr-uuid" } } }),
      },
      from: (table: string) => {
        if (table === "date_settings") {
          return {
            insert: async () => ({ error: null }),
            upsert: async () => ({ error: { message: "db down" } }),
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      },
    });
    const result = await _setDetailLevelWithNotifyForTest(
      "2026-04-28",
      "dual",
      true,
      factory,
      now,
      {
        sendEmail: async () => {
          sendCalls++;
        },
        loadSchedule: async () => [sampleEntry],
        appUrl: "https://test.example",
      }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("db down");
    expect(sendCalls).toBe(0);
  });

  test("email send failure does not roll back save", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    const state: NotifyMockState = {
      upsertedRows: [],
      selectedDates: [],
      previousLevel: "none",
      actorRow: { id: "mgr-uuid", full_name: "Jane", email: "jane@x" },
      otherManagers: [
        { id: "m2", full_name: "Bob", email: "bob@x" },
        { id: "m3", full_name: "Carol", email: "carol@x" },
      ],
    };
    const result = await _setDetailLevelWithNotifyForTest(
      "2026-04-28",
      "single",
      true,
      makeNotifyFactory(state),
      now,
      {
        sendEmail: async (args) => {
          if (args.to === "carol@x") throw new Error("smtp 500");
        },
        loadSchedule: async () => [sampleEntry],
        appUrl: "https://test.example",
      }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.emailError).toBe("Some notifications failed (1 of 2)");
    }
    expect(state.upsertedRows.length).toBe(1);
  });

  test("missing email config returns 'Email not configured'", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    const state: NotifyMockState = {
      upsertedRows: [],
      selectedDates: [],
      previousLevel: "single",
      actorRow: { id: "mgr-uuid", full_name: "Jane", email: "jane@x" },
      otherManagers: [{ id: "m2", full_name: "Bob", email: "bob@x" }],
    };
    const result = await _setDetailLevelWithNotifyForTest(
      "2026-04-28",
      "dual",
      true,
      makeNotifyFactory(state),
      now,
      {
        sendEmail: async () => {
          throw new EmailNotConfiguredError();
        },
        loadSchedule: async () => [sampleEntry],
        appUrl: "https://test.example",
      }
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.emailError).toBe("Email not configured");
  });

  test("no other managers — save succeeds, no email attempt", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    const state: NotifyMockState = {
      upsertedRows: [],
      selectedDates: [],
      previousLevel: "single",
      actorRow: { id: "mgr-uuid", full_name: "Jane", email: "jane@x" },
      otherManagers: [],
    };
    let sendCalls = 0;
    const result = await _setDetailLevelWithNotifyForTest(
      "2026-04-28",
      "dual",
      true,
      makeNotifyFactory(state),
      now,
      {
        sendEmail: async () => {
          sendCalls++;
        },
        loadSchedule: async () => [sampleEntry],
        appUrl: "https://test.example",
      }
    );
    expect(result).toEqual({ ok: true });
    expect(sendCalls).toBe(0);
  });

  test("missing schedule entry still sends with null entry", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    const state: NotifyMockState = {
      upsertedRows: [],
      selectedDates: [],
      previousLevel: "single",
      actorRow: { id: "mgr-uuid", full_name: "Jane", email: "jane@x" },
      otherManagers: [{ id: "m2", full_name: "Bob", email: "bob@x" }],
    };
    let sentSubject = "";
    const result = await _setDetailLevelWithNotifyForTest(
      "2026-04-28",
      "dual",
      true,
      makeNotifyFactory(state),
      now,
      {
        sendEmail: async (args) => {
          sentSubject = args.subject;
        },
        loadSchedule: async () => [], // no entry for this date
        appUrl: "https://test.example",
      }
    );
    expect(result).toEqual({ ok: true });
    expect(sentSubject).toContain("2026-04-28");
  });
});
