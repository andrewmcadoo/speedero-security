import { describe, expect, test } from "bun:test";
import { buildWatchdogAlertEmail } from "./watchdog-alert";

describe("buildWatchdogAlertEmail", () => {
  test("subject signals the capture cron may have STOPPED", () => {
    const e = buildWatchdogAlertEmail({
      lastSuccessAt: "2026-06-28T06:00:00.000Z",
      ageHours: 30,
    });
    expect(e.subject).toContain("STOPPED");
  });

  test("renders the last success time and rounded age", () => {
    const e = buildWatchdogAlertEmail({
      lastSuccessAt: "2026-06-28T06:00:00.000Z",
      ageHours: 30.4,
    });
    expect(e.text).toContain("2026-06-28T06:00:00.000Z");
    expect(e.text).toContain("30h ago");
    expect(e.html).toContain("2026-06-28T06:00:00.000Z");
  });

  test("null lastSuccessAt renders the 'never' case in text and html", () => {
    const e = buildWatchdogAlertEmail({ lastSuccessAt: null, ageHours: null });
    expect(e.text).toContain("never");
    expect(e.html).toContain("never");
  });

  test("escapes HTML in the rendered timestamp string", () => {
    const e = buildWatchdogAlertEmail({
      lastSuccessAt: "<script>alert(1)</script>",
      ageHours: 30,
    });
    expect(e.html).toContain("&lt;script&gt;");
    expect(e.html).not.toContain("<script>");
  });

  test("text and html both point at the timer and journal", () => {
    const e = buildWatchdogAlertEmail({
      lastSuccessAt: "2026-06-28T06:00:00.000Z",
      ageHours: 30,
    });
    for (const body of [e.text, e.html]) {
      expect(body).toContain("speedero-snapshot.timer");
      expect(body).toContain("speedero-security");
    }
  });
});
