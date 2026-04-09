import { formatDateHeader } from "@/lib/schedule-utils";
import type { ScheduleEntry } from "@/types/schedule";
import { StatusBadge } from "./status-badge";

export function DateHeader({
  dateStr,
  status,
}: {
  dateStr: string;
  status: ScheduleEntry["confirmationStatus"];
}) {
  const label = formatDateHeader(dateStr);
  return (
    <div className="flex items-center justify-between rounded-md bg-gray-900 px-3 py-2 text-xs text-gray-400">
      <span suppressHydrationWarning>{label}</span>
      <StatusBadge status={status} />
    </div>
  );
}
