"use client";

import type { DashboardEntry } from "@/types/schedule";
import { formatDateHeader } from "@/lib/schedule-utils";

export function MissingCard({
  entry,
  todayISO,
  tomorrowISO,
}: {
  entry: DashboardEntry;
  todayISO: string;
  tomorrowISO: string;
}) {
  return (
    <div
      className="rounded-lg border-l-3 border-dashed border-gray-700 bg-gray-900/50 p-3"
      title="No snapshot was captured for this date. The source row was likely deleted before the nightly snapshot or any dashboard load could capture it."
    >
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-gray-500">
          {formatDateHeader(entry.date, todayISO, tomorrowISO)}
        </div>
        <div className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-500">
          ? no snapshot
        </div>
      </div>
    </div>
  );
}
