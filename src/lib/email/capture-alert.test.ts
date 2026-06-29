import { describe, expect, test } from "bun:test";
import { buildCaptureAlertEmail } from "./capture-alert";

describe("buildCaptureAlertEmail", () => {
  test("subject and body include the date and the issues", () => {
    const e = buildCaptureAlertEmail({
      today: "2026-06-29",
      issues: ["Google Sheet fetch returned 0 rows"],
    });
    expect(e.subject).toContain("2026-06-29");
    expect(e.text).toContain("Google Sheet fetch returned 0 rows");
    expect(e.html).toContain("<li>");
  });

  test("escapes HTML in issue text", () => {
    const e = buildCaptureAlertEmail({
      today: "2026-06-29",
      issues: ["<script>alert(1)</script>"],
    });
    expect(e.html).toContain("&lt;script&gt;");
    expect(e.html).not.toContain("<script>");
  });
});
