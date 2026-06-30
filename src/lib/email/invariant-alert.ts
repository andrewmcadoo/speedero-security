export interface InvariantAlertEmail {
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
 * Alert email for a capture-completeness violation: past days the mirror has
 * content for that were never frozen into card_snapshots (so they render as
 * blank/missing cards). This is a data-correctness alarm — the nightly reconcile
 * should have captured these, so a hit means capture is silently failing.
 */
export function buildInvariantAlertEmail(args: {
  missing: string[];
}): InvariantAlertEmail {
  const n = args.missing.length;
  const list = args.missing.join(", ");
  const subject = `⚠ SecApp: ${n} past day(s) missing a snapshot`;
  const text =
    `SecApp's capture-completeness check found ${n} past day(s) the mirror has ` +
    `content for but that were never frozen into card_snapshots:\n\n${list}\n\n` +
    `These render as blank/missing cards. The nightly reconcile should have ` +
    `captured them — check the speedero-security journal and the snapshot cron.`;
  const html =
    `<p>SecApp's capture-completeness check found <b>${n}</b> past day(s) the ` +
    `mirror has content for but that were never frozen into ` +
    `<code>card_snapshots</code>:</p><p>${escapeHtml(list)}</p>` +
    `<p>These render as blank/missing cards. The nightly reconcile should have ` +
    `captured them — check the <code>speedero-security</code> journal and the ` +
    `snapshot cron.</p>`;
  return { subject, html, text };
}
