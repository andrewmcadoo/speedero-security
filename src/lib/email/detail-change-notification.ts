import type { DetailLevel, ScheduleEntry } from "@/types/schedule";
import { DETAIL_LEVEL_LABELS } from "@/lib/detail-levels";

export interface BuildDetailChangeEmailArgs {
  date: string;                  // YYYY-MM-DD
  oldLevel: DetailLevel;
  newLevel: DetailLevel;
  scheduleEntry: ScheduleEntry | null;
  changedByName: string;
  appUrl: string;                // empty string allowed; omits the link line
}

export interface DetailChangeEmail {
  subject: string;
  html: string;
  text: string;
}

const DASH = "—";

function or(value: string): string {
  return value && value.trim().length > 0 ? value : DASH;
}

function locationLine(part: { airport: string; fbo: string; time: string }): string {
  const a = part.airport.trim();
  const f = part.fbo.trim();
  const t = part.time.trim();
  if (!a && !f && !t) return DASH;
  return `${or(a)} ${or(f)} @ ${or(t)}`;
}

function formatHumanDate(date: string): string {
  // Render YYYY-MM-DD as "Weekday, Mon DD YYYY" using UTC math (no host TZ drift).
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(dt);
}

export function buildDetailChangeEmail(
  args: BuildDetailChangeEmailArgs
): DetailChangeEmail {
  const { date, oldLevel, newLevel, scheduleEntry, changedByName, appUrl } =
    args;
  const newLabel = DETAIL_LEVEL_LABELS[newLevel];
  const oldLabel = DETAIL_LEVEL_LABELS[oldLevel];
  const human = formatHumanDate(date);

  const subject = `Detail changed for ${date}: ${newLabel}`;

  const linkLine = appUrl
    ? `\nOpen dashboard: ${appUrl}/dashboard?date=${date}\n`
    : "";

  const scheduleBlock = scheduleEntry
    ? [
        "Schedule for that day:",
        `  Activity:     ${or(scheduleEntry.activity)}`,
        `  Location:     ${or(scheduleEntry.location)}`,
        `  Departure:    ${locationLine(scheduleEntry.departure)}`,
        `  Arrival:      ${locationLine(scheduleEntry.arrival)}`,
        `  Confirmation: ${scheduleEntry.confirmationStatus}`,
        `  Teak Night:   ${scheduleEntry.teakNight ? "yes" : "no"}`,
      ].join("\n")
    : "No schedule entry for this date.";

  const text = [
    "Hi,",
    "",
    `${changedByName} updated the detail level for ${human}.`,
    "",
    `  New detail: ${newLabel}`,
    `  Previous:   ${oldLabel}`,
    "",
    scheduleBlock,
    linkLine,
    "— Speedero Security",
  ].join("\n");

  const escapeHtml = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const scheduleHtml = scheduleEntry
    ? `
      <p style="margin:16px 0 8px 0;font-weight:600;">Schedule for that day</p>
      <table style="border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:2px 12px 2px 0;color:#555;">Activity</td><td>${escapeHtml(or(scheduleEntry.activity))}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#555;">Location</td><td>${escapeHtml(or(scheduleEntry.location))}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#555;">Departure</td><td>${escapeHtml(locationLine(scheduleEntry.departure))}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#555;">Arrival</td><td>${escapeHtml(locationLine(scheduleEntry.arrival))}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#555;">Confirmation</td><td>${escapeHtml(scheduleEntry.confirmationStatus)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#555;">Teak Night</td><td>${scheduleEntry.teakNight ? "yes" : "no"}</td></tr>
      </table>
    `
    : `<p style="margin:16px 0;color:#555;">No schedule entry for this date.</p>`;

  const linkHtml = appUrl
    ? `<p style="margin:16px 0;"><a href="${appUrl}/dashboard?date=${date}">Open dashboard</a></p>`
    : "";

  const html = `<!doctype html>
<html>
<body style="font-family:system-ui,-apple-system,sans-serif;color:#111;background:#fafafa;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:20px;">
    <p style="margin:0 0 12px 0;">Hi,</p>
    <p style="margin:0 0 16px 0;">${escapeHtml(changedByName)} updated the detail level for <strong>${escapeHtml(human)}</strong>.</p>
    <p style="margin:0;"><strong>New detail:</strong> ${escapeHtml(newLabel)}</p>
    <p style="margin:4px 0 0 0;color:#555;">Previous: ${escapeHtml(oldLabel)}</p>
    ${scheduleHtml}
    ${linkHtml}
    <p style="margin:24px 0 0 0;color:#888;font-size:12px;">— Speedero Security</p>
  </div>
</body>
</html>`;

  return { subject, html, text };
}
