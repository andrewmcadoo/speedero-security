const TRANSITION_PREFIX_RE = /^\s*tt:\s*/i;

/**
 * If `title` begins with a `TT:` prefix (case-insensitive, allowing leading
 * whitespace and optional whitespace after the colon), return the title
 * with the prefix stripped and trimmed. Otherwise (or if the post-strip
 * title is empty), return `null`.
 */
export function stripTransitionPrefix(title: string): string | null {
  if (!TRANSITION_PREFIX_RE.test(title)) return null;
  const stripped = title.replace(TRANSITION_PREFIX_RE, "").trim();
  return stripped === "" ? null : stripped;
}
