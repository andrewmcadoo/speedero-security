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

describe("fetchAllLiveSourcesCached — STALE hit (SWR)", () => {
  test("call between FRESH_MS and STALE_MS returns stale value AND triggers background refresh", async () => {
    const sourcesA = makeSources("A");
    const sourcesB = makeSources("B");
    const { fetcher, callCount } = makeFetcher([sourcesA, sourcesB]);
    let now = 1_000_000;

    // First call — populates cache.
    await _fetchAllLiveSourcesCachedForTest(
      STUB_SUPABASE,
      "2026-04-28",
      fetcher,
      () => now
    );
    expect(callCount()).toBe(1);

    // Advance into the stale window.
    now += FRESH_MS + 1;

    const r2 = await _fetchAllLiveSourcesCachedForTest(
      STUB_SUPABASE,
      "2026-04-28",
      fetcher,
      () => now
    );
    expect(r2).toBe(sourcesA); // STALE hit returns the OLD value immediately.

    // Background refresh has been kicked off. Wait for it to complete.
    // We yield to the microtask queue twice: once for the stub fetcher's
    // own promise, once for the .then handler that writes back to cache.
    await Promise.resolve();
    await Promise.resolve();

    expect(callCount()).toBe(2); // background fetch ran.
    const peeked = _peekForTest();
    expect(peeked?.value).toBe(sourcesB); // cache now has the fresh value.
    expect(peeked?.refreshing).toBe(false);
  });

  test("multiple STALE hits do not stack background refreshes", async () => {
    const sourcesA = makeSources("A");
    const sourcesB = makeSources("B");
    const { fetcher, callCount } = makeFetcher([sourcesA, sourcesB]);
    let now = 1_000_000;

    await _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, () => now);
    expect(callCount()).toBe(1);

    now += FRESH_MS + 1;
    // Three rapid STALE-hit calls before the background refresh resolves.
    await _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, () => now);
    await _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, () => now);
    await _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, () => now);

    // Only one background refresh in flight.
    expect(callCount()).toBe(2);
  });
});
