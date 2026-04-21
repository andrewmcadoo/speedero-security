/**
 * Deterministic color assignment for EPO users.
 * Each EPO gets a consistent color based on their ID.
 */

// Avoid green (confirmed, teak night, pick up), rose (drop off), yellow/amber (pending), red (coverage)
const EPO_COLORS = [
  { bg: "bg-cyan-900/60", text: "text-cyan-300" },
  { bg: "bg-sky-900/60", text: "text-sky-300" },
  { bg: "bg-indigo-900/60", text: "text-indigo-300" },
  { bg: "bg-blue-900/60", text: "text-blue-300" },
  { bg: "bg-slate-700/60", text: "text-slate-300" },
  { bg: "bg-zinc-700/60", text: "text-zinc-300" },
] as const;

/** Hash a string to a stable index. */
function hashToIndex(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % EPO_COLORS.length;
}

export function getEpoColor(epoId: string) {
  return EPO_COLORS[hashToIndex(epoId)];
}
