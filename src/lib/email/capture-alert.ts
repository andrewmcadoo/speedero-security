export interface CaptureAlertEmail {
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
 * Build the alert email sent when the nightly snapshot run detects that card
 * capture is unhealthy (see assessCaptureHealth). This is the observability that
 * was missing — a durable-capture system with no alarm on its own durability is
 * how the cron silently captured nothing for ~2 months.
 */
export function buildCaptureAlertEmail(args: {
  today: string;
  issues: string[];
}): CaptureAlertEmail {
  const { today, issues } = args;
  const subject = `⚠ SecApp snapshot capture issue (${today})`;
  const text =
    `SecApp's nightly snapshot run on ${today} reported capture problems:\n\n` +
    issues.map((i) => `• ${i}`).join("\n") +
    `\n\nPast cards may be missing from the dashboard. Check the ` +
    `speedero-security journal and the Google Sheets sync.`;
  const html =
    `<p>SecApp's nightly snapshot run on <b>${escapeHtml(today)}</b> reported ` +
    `capture problems:</p><ul>` +
    issues.map((i) => `<li>${escapeHtml(i)}</li>`).join("") +
    `</ul><p>Past cards may be missing from the dashboard. Check the ` +
    `<code>speedero-security</code> journal and the Google Sheets sync.</p>`;
  return { subject, html, text };
}
