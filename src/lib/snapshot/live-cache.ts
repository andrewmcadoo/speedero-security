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
  }
  const value = await fetcher(supabase, today);
  cache = {
    today,
    fetchedAt: now(),
    refreshing: false,
    value,
    pendingFetch: null,
  };
  return value;
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
