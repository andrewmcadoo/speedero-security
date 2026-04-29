import { getAnchorDates } from "./schedule-utils";

export class PastDateWriteError extends Error {
  constructor(public readonly date: string, public readonly today: string) {
    super(`Refusing to mutate past date ${date} (today is ${today})`);
    this.name = "PastDateWriteError";
  }
}

/**
 * Throws PastDateWriteError when `dateStr` is strictly before today in
 * APP_TIMEZONE. "Today" is the same string returned by `getAnchorDates`,
 * so this is the single source of truth for the past/present boundary.
 *
 * `now` is exposed for testing only.
 */
export function assertNotPast(dateStr: string, now: Date = new Date()): void {
  const { today } = getAnchorDates(now);
  if (dateStr < today) {
    throw new PastDateWriteError(dateStr, today);
  }
}
