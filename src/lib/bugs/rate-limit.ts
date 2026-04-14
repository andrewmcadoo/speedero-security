export type RateLimiterOptions = {
  max: number;
  windowMs: number;
  now?: () => number;
};

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

export type RateLimiter = {
  check: (key: string) => RateLimitResult;
};

export function createRateLimiter({
  max,
  windowMs,
  now = () => Date.now(),
}: RateLimiterOptions): RateLimiter {
  const hits = new Map<string, number[]>();

  return {
    check(key) {
      const current = now();
      const cutoff = current - windowMs;
      const previous = hits.get(key) ?? [];
      const recent = previous.filter((t) => t > cutoff);

      if (recent.length >= max) {
        const oldest = recent[0];
        const retryAfterMs = oldest + windowMs - current;
        hits.set(key, recent);
        return { allowed: false, retryAfterMs };
      }

      recent.push(current);
      hits.set(key, recent);
      return { allowed: true };
    },
  };
}
