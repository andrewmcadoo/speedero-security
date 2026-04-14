import { describe, expect, test } from "bun:test";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  test("allows up to max calls within window", () => {
    let current = 0;
    const limiter = createRateLimiter({ max: 5, windowMs: 3600_000, now: () => current });
    for (let i = 0; i < 5; i++) {
      expect(limiter.check("aj@example.com").allowed).toBe(true);
    }
  });

  test("rejects the max+1 call within window", () => {
    let current = 0;
    const limiter = createRateLimiter({ max: 5, windowMs: 3600_000, now: () => current });
    for (let i = 0; i < 5; i++) limiter.check("aj@example.com");
    const result = limiter.check("aj@example.com");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  test("resets after window elapses", () => {
    let current = 0;
    const limiter = createRateLimiter({ max: 5, windowMs: 3600_000, now: () => current });
    for (let i = 0; i < 5; i++) limiter.check("aj@example.com");
    current = 3600_001;
    expect(limiter.check("aj@example.com").allowed).toBe(true);
  });

  test("tracks keys independently", () => {
    let current = 0;
    const limiter = createRateLimiter({ max: 5, windowMs: 3600_000, now: () => current });
    for (let i = 0; i < 5; i++) limiter.check("aj@example.com");
    expect(limiter.check("other@example.com").allowed).toBe(true);
  });

  test("retryAfterMs reflects oldest-in-window timestamp", () => {
    let current = 0;
    const limiter = createRateLimiter({ max: 2, windowMs: 1000, now: () => current });
    limiter.check("aj@example.com"); // t=0
    current = 400;
    limiter.check("aj@example.com"); // t=400
    current = 500;
    const result = limiter.check("aj@example.com");
    expect(result.allowed).toBe(false);
    // oldest timestamp is 0, window 1000, now 500 → retry in 500ms
    expect(result.retryAfterMs).toBe(500);
  });

  test("filters out entries at exactly the cutoff boundary", () => {
    // Strict `>` filter: at current = windowMs, the t=0 entry should be dropped
    let current = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: () => current });
    expect(limiter.check("aj@example.com").allowed).toBe(true); // t=0
    current = 1000; // exactly windowMs elapsed
    expect(limiter.check("aj@example.com").allowed).toBe(true); // t=0 is now at cutoff, filtered
  });

  test("sliding window: allows again when only the oldest entry has expired", () => {
    // max=2, window=1000ms. Fill with entries at t=0 and t=400.
    // At t=500 we're rejected (2 entries in window).
    // At t=1001 the t=0 entry expires, leaving 1 in the window → allowed.
    let current = 0;
    const limiter = createRateLimiter({ max: 2, windowMs: 1000, now: () => current });
    limiter.check("aj@example.com"); // t=0
    current = 400;
    limiter.check("aj@example.com"); // t=400
    current = 500;
    expect(limiter.check("aj@example.com").allowed).toBe(false);
    current = 1001;
    expect(limiter.check("aj@example.com").allowed).toBe(true);
  });
});
