/**
 * Liveness for the nightly snapshot capture cron.
 *
 * The heartbeat records that the reconcile *executed successfully* (distinct
 * from whether capture was *healthy*). The watchdog reads it to detect a
 * silently-stopped cron — the one failure class the run-time capture-health
 * alerting cannot see, because that alerting only fires when a run executes.
 */

export const WATCHDOG_MAX_AGE_HOURS = 26;
export const SNAPSHOT_RUN_HEARTBEAT = "snapshot-run";

/**
 * Pure staleness check. A `null` or unparseable lastSuccessAt is treated as
 * stale with a `null` age. A future timestamp clamps to age 0 (fresh). Otherwise
 * stale when the age strictly exceeds the threshold (`>`, so a heartbeat exactly
 * at the threshold is still fresh).
 */
export function assessHeartbeatStaleness(args: {
  lastSuccessAt: string | null;
  now: Date;
  thresholdHours: number;
}): { stale: boolean; ageHours: number | null } {
  if (!args.lastSuccessAt) return { stale: true, ageHours: null };
  const parsed = new Date(args.lastSuccessAt).getTime();
  // An unparseable timestamp would yield NaN, and `NaN > threshold` is false —
  // i.e. silently "fresh". Treat unusable data as stale so it can't hide a
  // stopped cron.
  if (!Number.isFinite(parsed)) return { stale: true, ageHours: null };
  // Clamp a future heartbeat (clock skew / bad write) to age 0 rather than a
  // negative age that would read as fresh forever.
  const ageHours = Math.max(0, (args.now.getTime() - parsed) / 3_600_000);
  return { stale: ageHours > args.thresholdHours, ageHours };
}
