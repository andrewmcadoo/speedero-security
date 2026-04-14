export type FormatIssueInput = {
  description: string;
  email: string;
  url: string;
  timestamp: string;
  userAgent: string;
};

export type FormattedIssue = {
  title: string;
  body: string;
  labels: string[];
};

const TITLE_MAX = 60;
const MIN_DESCRIPTION_FOR_TITLE = 10;

export function formatIssue(input: FormatIssueInput): FormattedIssue {
  const trimmed = input.description.trim();

  const title =
    trimmed.length < MIN_DESCRIPTION_FOR_TITLE
      ? `Bug report from ${input.email}`
      : trimmed.slice(0, TITLE_MAX);

  const body = [
    `Reported by: ${input.email}`,
    `URL: ${input.url}`,
    `Time: ${input.timestamp}`,
    `User agent: ${input.userAgent}`,
    "",
    "---",
    "",
    input.description,
  ].join("\n");

  return {
    title,
    body,
    labels: ["bug", "user-report"],
  };
}
