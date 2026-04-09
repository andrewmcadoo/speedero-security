import type { ScheduleEntry } from "@/types/schedule";

const statusConfig = {
  confirmed: {
    label: "CONFIRMED",
    color: "text-green-400",
    icon: "✓",
  },
  pending: {
    label: "PENDING",
    color: "text-yellow-400",
    icon: "●",
  },
  unconfirmed: {
    label: "UNCONFIRMED",
    color: "text-gray-500",
    icon: "●",
  },
} as const;

export function StatusBadge({
  status,
}: {
  status: ScheduleEntry["confirmationStatus"];
}) {
  const config = statusConfig[status];
  return (
    <span className={`text-xs font-medium ${config.color}`}>
      {config.icon} {config.label}
    </span>
  );
}

export function statusBorderColor(
  status: ScheduleEntry["confirmationStatus"]
): string {
  switch (status) {
    case "confirmed":
      return "border-l-green-500";
    case "pending":
      return "border-l-yellow-500";
    case "unconfirmed":
      return "border-l-gray-600";
  }
}
