/**
 * Capture-completeness invariant — a data-correctness check, complementary to
 * the watchdog (which checks the cron is *running*) and capture-health (which
 * checks a *single run*). The nightly reconcile freezes every past date the
 * durable mirror has into `card_snapshots`; this verifies it actually did.
 *
 * A mirror date `< today` with no snapshot means capture silently failed for
 * that day — exactly the bug class that let cards go missing without any error.
 * False positives are near-zero: the mirror only holds days we genuinely have
 * content for, and the reconcile is supposed to close this every night.
 */

export const CAPTURE_INVARIANT = "snapshot-completeness";

/**
 * Pure: mirror past-dates that lack a snapshot, deduped and sorted ascending.
 * Inputs are already filtered to `< today` by the callers' queries.
 */
export function selectMissingSnapshots(
  mirrorPastDates: string[],
  snapshotDates: Set<string>
): string[] {
  return Array.from(new Set(mirrorPastDates))
    .filter((d) => !snapshotDates.has(d))
    .sort();
}
