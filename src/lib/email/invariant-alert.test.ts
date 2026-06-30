import { describe, expect, test } from "bun:test";
import { buildInvariantAlertEmail } from "./invariant-alert";

describe("buildInvariantAlertEmail", () => {
  test("subject and body include the count and the dates", () => {
    const e = buildInvariantAlertEmail({ missing: ["2026-06-20", "2026-06-21"] });
    expect(e.subject).toContain("2 past day");
    expect(e.text).toContain("2026-06-20");
    expect(e.text).toContain("2026-06-21");
    expect(e.html).toContain("<b>2</b>");
  });

  test("escapes HTML in the date list", () => {
    const e = buildInvariantAlertEmail({ missing: ["<x>"] });
    expect(e.html).toContain("&lt;x&gt;");
    expect(e.html).not.toContain("<x>");
  });
});
