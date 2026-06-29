export interface WatchdogAlertEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!
  );
}

/**
 * Build the alert email sent when the capture watchdog finds the nightly
 * snapshot reconcile has not reported success within the staleness window (or
 * never has). This is the dead-man's-switch: it fires when the cron *fails to
 * execute at all*, the one class the run-time capture-health alert cannot see.
 */
export function buildWatchdogAlertEmail(args: {
  lastSuccessAt: string | null;
  ageHours: number | null;
}): WatchdogAlertEmail {
  const when = args.lastSuccessAt
    ? `${args.lastSuccessAt} (~${Math.round(args.ageHours ?? 0)}h ago)`
    : "never (no heartbeat recorded)";
  const subject = "⚠ SecApp capture cron may have STOPPED";
  const text =
    `SecApp's nightly snapshot reconcile has not reported success recently.\n\n` +
    `Last successful run: ${when}.\n\n` +
    `Card capture may be silently stopped. Check the speedero-snapshot.timer ` +
    `and the speedero-security journal.`;
  const html =
    `<p>SecApp's nightly snapshot reconcile has not reported success recently.</p>` +
    `<p>Last successful run: <b>${escapeHtml(when)}</b>.</p>` +
    `<p>Card capture may be silently stopped. Check ` +
    `<code>speedero-snapshot.timer</code> and the ` +
    `<code>speedero-security</code> journal.</p>`;
  return { subject, html, text };
}
