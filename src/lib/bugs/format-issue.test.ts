import { describe, expect, test } from "bun:test";
import { formatIssue } from "./format-issue";

const META = {
  email: "aj@example.com",
  url: "https://secapp.example.com/dashboard",
  timestamp: "2026-04-13T14:23:00.000Z",
  userAgent: "Mozilla/5.0 (Test)",
};

describe("formatIssue", () => {
  test("uses first 60 chars of description as title", () => {
    const description = "The EPO dropdown does not save when I click submit quickly";
    const issue = formatIssue({ description, ...META });
    expect(issue.title).toBe("The EPO dropdown does not save when I click submit quickly");
  });

  test("truncates long descriptions to 60 chars", () => {
    const description = "x".repeat(70);
    const issue = formatIssue({ description, ...META });
    expect(issue.title).toBe("x".repeat(60));
  });

  test("falls back when description is shorter than 10 chars", () => {
    const issue = formatIssue({ description: "typo", ...META });
    expect(issue.title).toBe("Bug report from aj@example.com");
  });

  test("body contains metadata block, separator, and full description", () => {
    const description = "Detailed repro steps here";
    const issue = formatIssue({ description, ...META });
    expect(issue.body).toBe(
      [
        "Reported by: aj@example.com",
        "URL: https://secapp.example.com/dashboard",
        "Time: 2026-04-13T14:23:00.000Z",
        "User agent: Mozilla/5.0 (Test)",
        "",
        "---",
        "",
        "Detailed repro steps here",
      ].join("\n")
    );
  });

  test("applies bug and user-report labels", () => {
    const issue = formatIssue({ description: "something broke", ...META });
    expect(issue.labels).toEqual(["bug", "user-report"]);
  });

  test("trims leading whitespace before slicing title", () => {
    const description = "   leading spaces in description text here and more content";
    const issue = formatIssue({ description, ...META });
    expect(issue.title).toBe(description.trim().slice(0, 60));
  });

  test("uses description when length is exactly 10 (boundary)", () => {
    const description = "0123456789"; // exactly 10 chars
    const issue = formatIssue({ description, ...META });
    expect(issue.title).toBe("0123456789");
  });

  test("falls back when length is 9 (boundary)", () => {
    const description = "012345678"; // 9 chars
    const issue = formatIssue({ description, ...META });
    expect(issue.title).toBe("Bug report from aj@example.com");
  });

  test("collapses newlines in title", () => {
    const description = "Button crashes\n\nsteps:\n1. open page";
    const issue = formatIssue({ description, ...META });
    expect(issue.title).toBe("Button crashes steps: 1. open page");
    // body preserves the original description (unchanged)
    expect(issue.body.endsWith(description)).toBe(true);
  });
});
