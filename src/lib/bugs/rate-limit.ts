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
  // Remove the most recent hit for `key` if one exists. Use after `check`
  // returned `{allowed: true}` but the downstream work actually failed,
  // so the user's quota isn't consumed by an error outside their control.
  rollback: (key: string) => void;
};

export function createRateLimiter({
  max,
  windowMs,
  now = () => Date.now(),
}: RateLimiterOptions): RateLimiter {
  // Keys are never deleted — acceptable here because the user set is small
  // and bounded. If reused for untrusted/unbounded keys (IPs, etc.), add
  // periodic pruning of empty entries.
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
    rollback(key) {
      const current = hits.get(key);
      if (current && current.length > 0) {
        current.pop();
      }
    },
  };
}
