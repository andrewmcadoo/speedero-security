import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCronHeartbeat, recordCronHeartbeat } from "./queries";

/**
 * Fake Supabase that records the table and upsert payload/options for
 * recordCronHeartbeat. The upsert() result resolves to `result`.
 */
function fakeUpsertClient(result: { error: { message: string } | null }) {
  const calls: {
    table?: string;
    payload?: Record<string, unknown>;
    options?: { onConflict?: string };
  } = {};
  const client = {
    from(table: string) {
      calls.table = table;
      return {
        upsert(
          payload: Record<string, unknown>,
          options: { onConflict?: string }
        ) {
          calls.payload = payload;
          calls.options = options;
          return Promise.resolve(result);
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

/**
 * Fake Supabase for getCronHeartbeat: .from().select().eq().maybeSingle().
 */
function fakeSelectClient(result: {
  data: { last_success_at: string } | null;
  error: { message: string } | null;
}) {
  const calls: { table?: string; selected?: string; eqArgs?: [string, string] } =
    {};
  const client = {
    from(table: string) {
      calls.table = table;
      return {
        select(columns: string) {
          calls.selected = columns;
          return {
            eq(column: string, value: string) {
              calls.eqArgs = [column, value];
              return {
                maybeSingle() {
                  return Promise.resolve(result);
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("recordCronHeartbeat", () => {
  test("upserts { name, last_success_at } on cron_heartbeats with onConflict name", async () => {
    const { client, calls } = fakeUpsertClient({ error: null });
    await recordCronHeartbeat(client, "snapshot-run");
    expect(calls.table).toBe("cron_heartbeats");
    expect(calls.payload?.name).toBe("snapshot-run");
    expect(calls.options?.onConflict).toBe("name");
  });

  test("writes a valid ISO timestamp for last_success_at", async () => {
    const { client, calls } = fakeUpsertClient({ error: null });
    await recordCronHeartbeat(client, "snapshot-run");
    const ts = calls.payload?.last_success_at as string;
    expect(typeof ts).toBe("string");
    expect(Number.isNaN(Date.parse(ts))).toBe(false);
  });

  test("does not throw when the upsert returns an error", async () => {
    const { client } = fakeUpsertClient({ error: { message: "boom" } });
    await expect(
      recordCronHeartbeat(client, "snapshot-run")
    ).resolves.toBeUndefined();
  });
});

describe("getCronHeartbeat", () => {
  test("returns the stored last_success_at", async () => {
    const { client, calls } = fakeSelectClient({
      data: { last_success_at: "2026-06-29T12:00:00.000Z" },
      error: null,
    });
    const got = await getCronHeartbeat(client, "snapshot-run");
    expect(got).toBe("2026-06-29T12:00:00.000Z");
    expect(calls.table).toBe("cron_heartbeats");
    expect(calls.selected).toBe("last_success_at");
    expect(calls.eqArgs).toEqual(["name", "snapshot-run"]);
  });

  test("returns null when no row exists", async () => {
    const { client } = fakeSelectClient({ data: null, error: null });
    expect(await getCronHeartbeat(client, "snapshot-run")).toBeNull();
  });

  test("returns null on query error", async () => {
    const { client } = fakeSelectClient({
      data: null,
      error: { message: "boom" },
    });
    expect(await getCronHeartbeat(client, "snapshot-run")).toBeNull();
  });
});
