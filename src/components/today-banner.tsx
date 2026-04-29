"use client";

import { formatDateHeader } from "@/lib/schedule-utils";

type Props = {
  todayISO: string;
  tomorrowISO: string;
  visible: boolean;
  onJumpToToday: () => void;
};

export function TodayBanner({ todayISO, tomorrowISO, visible, onJumpToToday }: Props) {
  if (!visible) return null;
  const label = formatDateHeader(todayISO, todayISO, tomorrowISO);
  return (
    <button
      type="button"
      onClick={onJumpToToday}
      className="flex w-full items-center justify-between rounded-md bg-blue-900/60 px-3 py-1.5 text-xs text-blue-400 transition-colors hover:bg-blue-900/80"
      aria-label="Jump to today"
    >
      <span className="font-medium uppercase tracking-wide">{label}</span>
      <span aria-hidden className="text-[10px] opacity-70">↓ jump</span>
    </button>
  );
}
