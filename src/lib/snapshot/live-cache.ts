import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssembleSources } from "./assemble";
import { fetchAllLiveSources } from "./freeze";

export const FRESH_MS = 10_000;
export const STALE_MS = 60_000;

type CacheEntry = {
  today: string;
  fetchedAt: number;
  refreshing: boolean;
  value: AssembleSources;
  pendingFetch: Promise<AssembleSources> | null;
};

let cache: CacheEntry | null = null;

export function invalidateLiveSourcesCache(): void {
  cache = null;
}

export function _resetForTest(): void {
  cache = null;
}

export function _peekForTest(): CacheEntry | null {
  return cache;
}

type Fetcher = (
  supabase: SupabaseClient,
  today: string
) => Promise<AssembleSources>;

export async function _fetchAllLiveSourcesCachedForTest(
  supabase: SupabaseClient,
  today: string,
  fetcher: Fetcher,
  now: () => number
): Promise<AssembleSources> {
  if (cache && cache.today === today) {
    const age = now() - cache.fetchedAt;
    if (age < FRESH_MS) {
      return cache.value;
    }
    if (age < STALE_MS) {
      kickOffBackgroundRefresh(supabase, today, fetcher, now);
      return cache.value;
    }
  }

  // Concurrent-miss dedupe: if a fetch is already in flight for this `today`,
  // share its promise rather than fanning out a second call.
  if (cache && cache.today === today && cache.pendingFetch) {
    return cache.pendingFetch;
  }

  const promise = fetcher(supabase, today);
  cache = {
    today,
    fetchedAt: 0, // not yet finalized — will be set on success.
    refreshing: false,
    value: undefined as unknown as AssembleSources,
    pendingFetch: promise,
  };
  try {
    const value = await promise;
    cache = {
      today,
      fetchedAt: now(),
      refreshing: false,
      value,
      pendingFetch: null,
    };
    return value;
  } catch (err) {
    cache = null; // don't pin a failure — next caller retries.
    throw err;
  }
}

function kickOffBackgroundRefresh(
  supabase: SupabaseClient,
  today: string,
  fetcher: Fetcher,
  now: () => number
): void {
  if (!cache || cache.refreshing) return;
  cache.refreshing = true;
  fetcher(supabase, today)
    .then((value) => {
      // Guard against day-rollover during the in-flight refresh: if the
      // cached `today` no longer matches what we fetched for, drop the result.
      if (!cache || cache.today !== today) return;
      cache = {
        today,
        fetchedAt: now(),
        refreshing: false,
        value,
        pendingFetch: null,
      };
    })
    .catch((err) => {
      console.error("[live-cache] background refresh failed:", err);
      if (cache) cache.refreshing = false;
    });
}

export function fetchAllLiveSourcesCached(
  supabase: SupabaseClient,
  today: string
): Promise<AssembleSources> {
  return _fetchAllLiveSourcesCachedForTest(
    supabase,
    today,
    fetchAllLiveSources,
    Date.now
  );
}
