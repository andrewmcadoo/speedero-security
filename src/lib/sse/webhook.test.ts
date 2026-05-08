import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { verifyHmac } from "./webhook";

const SECRET = "test-secret-12345";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

describe("verifyHmac", () => {
  test("accepts valid signature", () => {
    const body = "hello";
    expect(verifyHmac(body, sign(body), SECRET)).toBe(true);
  });

  test("accepts valid signature for empty body", () => {
    expect(verifyHmac("", sign(""), SECRET)).toBe(true);
  });

  test("rejects wrong signature", () => {
    expect(verifyHmac("hello", sign("world"), SECRET)).toBe(false);
  });

  test("rejects null signature", () => {
    expect(verifyHmac("hello", null, SECRET)).toBe(false);
  });

  test("rejects empty signature", () => {
    expect(verifyHmac("hello", "", SECRET)).toBe(false);
  });

  test("rejects missing secret (env unset)", () => {
    expect(verifyHmac("hello", sign("hello"), undefined)).toBe(false);
  });

  test("rejects malformed hex signature without throwing", () => {
    expect(verifyHmac("hello", "not-hex-zzz", SECRET)).toBe(false);
  });

  test("rejects signature of wrong length without throwing", () => {
    expect(verifyHmac("hello", "abcd", SECRET)).toBe(false);
  });
});

import { processSheetChange } from "./webhook";

describe("processSheetChange — invariants", () => {
  test("calls invalidate before broadcast (order-sensitive)", () => {
    const calls: string[] = [];
    processSheetChange({
      invalidate: () => calls.push("invalidate"),
      broadcast: () => calls.push("broadcast"),
    });
    expect(calls).toEqual(["invalidate", "broadcast"]);
  });

  test("calls each dependency exactly once", () => {
    let invalidateCalls = 0;
    let broadcastCalls = 0;
    processSheetChange({
      invalidate: () => invalidateCalls++,
      broadcast: () => broadcastCalls++,
    });
    expect(invalidateCalls).toBe(1);
    expect(broadcastCalls).toBe(1);
  });
});
