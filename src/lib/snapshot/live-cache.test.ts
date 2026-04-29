import { afterEach, describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssembleSources } from "./assemble";
import {
  FRESH_MS,
  STALE_MS,
  _fetchAllLiveSourcesCachedForTest,
  _peekForTest,
  _resetForTest,
  invalidateLiveSourcesCache,
} from "./live-cache";

afterEach(() => {
  _resetForTest();
});

const STUB_SUPABASE = {} as SupabaseClient;

function makeSources(tag: string): AssembleSources {
  return {
    schedule: [],
    transitionsByDate: new Map(),
    assignmentsByDate: new Map(),
    travelLegsByDate: new Map(),
    settingsMap: new Map([[tag, { detailLevel: "none" }]]),
  };
}

function makeFetcher(values: AssembleSources[]): {
  fetcher: (s: SupabaseClient, t: string) => Promise<AssembleSources>;
  callCount: () => number;
} {
  let i = 0;
  let calls = 0;
  return {
    fetcher: async () => {
      calls++;
      const v = values[Math.min(i, values.length - 1)];
      i++;
      return v;
    },
    callCount: () => calls,
  };
}

describe("fetchAllLiveSourcesCached — FRESH hit", () => {
  test("first call fetches; second call within FRESH_MS returns cached value", async () => {
    const sourcesA = makeSources("A");
    const { fetcher, callCount } = makeFetcher([sourcesA]);
    let now = 1_000_000;

    const r1 = await _fetchAllLiveSourcesCachedForTest(
      STUB_SUPABASE,
      "2026-04-28",
      fetcher,
      () => now
    );
    expect(r1).toBe(sourcesA);
    expect(callCount()).toBe(1);

    now += FRESH_MS - 1; // still fresh
    const r2 = await _fetchAllLiveSourcesCachedForTest(
      STUB_SUPABASE,
      "2026-04-28",
      fetcher,
      () => now
    );
    expect(r2).toBe(sourcesA);
    expect(callCount()).toBe(1); // no second fetch
  });
});
