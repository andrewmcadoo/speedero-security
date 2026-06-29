import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { checkCronAuth } from "./cron-auth";

function req(authorization?: string): Request {
  return new Request("http://localhost/api/snapshot/run", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

describe("checkCronAuth", () => {
  const original = process.env.SNAPSHOT_CRON_TOKEN;

  beforeEach(() => {
    process.env.SNAPSHOT_CRON_TOKEN = "s3cr3t-token";
  });

  afterEach(() => {
    if (original === undefined) delete process.env.SNAPSHOT_CRON_TOKEN;
    else process.env.SNAPSHOT_CRON_TOKEN = original;
  });

  test("returns 'not-configured' when the token env is unset", () => {
    delete process.env.SNAPSHOT_CRON_TOKEN;
    expect(checkCronAuth(req("Bearer anything"))).toBe("not-configured");
  });

  test("returns 'ok' for the correct Bearer token", () => {
    expect(checkCronAuth(req("Bearer s3cr3t-token"))).toBe("ok");
  });

  test("returns 'unauthorized' for a wrong token of equal length", () => {
    expect(checkCronAuth(req("Bearer s3cr3t-tokeX"))).toBe("unauthorized");
  });

  test("returns 'unauthorized' (no throw) for a shorter token", () => {
    expect(checkCronAuth(req("Bearer short"))).toBe("unauthorized");
  });

  test("returns 'unauthorized' (no throw) for a longer token", () => {
    expect(checkCronAuth(req("Bearer s3cr3t-token-and-then-some"))).toBe(
      "unauthorized"
    );
  });

  test("returns 'unauthorized' when the Authorization header is missing", () => {
    expect(checkCronAuth(req())).toBe("unauthorized");
  });
});
