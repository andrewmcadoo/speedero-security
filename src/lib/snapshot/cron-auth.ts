import { timingSafeEqual } from "node:crypto";

/**
 * Shared Bearer-token auth for the unattended snapshot cron routes (run,
 * watchdog, prerollover). All three fire from systemd `curl` over loopback with
 * `Authorization: Bearer ${SNAPSHOT_CRON_TOKEN}`.
 *
 *  - `not-configured` — SNAPSHOT_CRON_TOKEN is unset (caller should 503).
 *  - `unauthorized`   — header missing or token mismatch (caller should 401).
 *  - `ok`             — token matches.
 */
export type CronAuthResult = "ok" | "not-configured" | "unauthorized";

export function checkCronAuth(request: Request): CronAuthResult {
  const expected = process.env.SNAPSHOT_CRON_TOKEN;
  if (!expected) return "not-configured";
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${expected}`);
  // timingSafeEqual throws on differing lengths, so length-guard first. The
  // length itself is not secret; the constant-time compare protects the token.
  if (provided.length !== wanted.length) return "unauthorized";
  return timingSafeEqual(provided, wanted) ? "ok" : "unauthorized";
}
