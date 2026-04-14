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
});
