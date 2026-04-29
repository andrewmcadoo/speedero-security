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

describe("fetchAllLiveSourcesCached — sync miss after STALE_MS", () => {
  test("call after STALE_MS sync-fetches and replaces the cache", async () => {
    const sourcesA = makeSources("A");
    const sourcesB = makeSources("B");
    const { fetcher, callCount } = makeFetcher([sourcesA, sourcesB]);
    let now = 1_000_000;

    await _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, () => now);
    expect(callCount()).toBe(1);

    now += STALE_MS + 1;
    const r = await _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, () => now);
    expect(r).toBe(sourcesB); // got the FRESH value, not the old A.
    expect(callCount()).toBe(2);
  });
});

describe("fetchAllLiveSourcesCached — concurrent miss dedupe", () => {
  test("two parallel calls during a cold miss share one fetch", async () => {
    const sourcesA = makeSources("A");
    let resolve!: (v: AssembleSources) => void;
    let calls = 0;
    const fetcher: (s: SupabaseClient, t: string) => Promise<AssembleSources> = () => {
      calls++;
      return new Promise<AssembleSources>((res) => {
        resolve = res;
      });
    };
    const now = () => 1_000_000;

    const p1 = _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, now);
    const p2 = _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, now);

    expect(calls).toBe(1); // both callers share one fetch.

    resolve(sourcesA);
    expect(await p1).toBe(sourcesA);
    expect(await p2).toBe(sourcesA);
    expect(calls).toBe(1);
  });

  test("a fetch failure does not pin the cache; next caller retries", async () => {
    let calls = 0;
    let mode: "fail" | "succeed" = "fail";
    const sourcesA = makeSources("A");
    const fetcher: (s: SupabaseClient, t: string) => Promise<AssembleSources> = async () => {
      calls++;
      if (mode === "fail") throw new Error("boom");
      return sourcesA;
    };
    const now = () => 1_000_000;

    await expect(
      _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, now)
    ).rejects.toThrow("boom");
    expect(_peekForTest()).toBeNull();

    mode = "succeed";
    const r = await _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, now);
    expect(r).toBe(sourcesA);
    expect(calls).toBe(2);
  });
});

describe("fetchAllLiveSourcesCached — day rollover", () => {
  test("when today changes, treat as a miss and refetch", async () => {
    const day1 = makeSources("day1");
    const day2 = makeSources("day2");
    const { fetcher, callCount } = makeFetcher([day1, day2]);
    let now = 1_000_000;

    await _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, () => now);
    expect(callCount()).toBe(1);

    // Same time, but today has rolled over.
    const r = await _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-29", fetcher, () => now);
    expect(r).toBe(day2);
    expect(callCount()).toBe(2);
    expect(_peekForTest()?.today).toBe("2026-04-29");
  });
});
