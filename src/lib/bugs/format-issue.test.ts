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

  test("truncates long descriptions at 60 chars without trailing whitespace", () => {
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

  test("trims whitespace when extracting title", () => {
    const issue = formatIssue({
      description: "   leading spaces in description text here and more content",
      ...META,
    });
    expect(issue.title.startsWith(" ")).toBe(false);
  });
});
