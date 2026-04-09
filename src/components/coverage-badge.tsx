import type { DetailLevel } from "@/types/schedule";
import { DETAIL_LEVEL_REQUIRED_EPOS } from "@/lib/detail-levels";

export function CoverageBadge({
  assigned,
  detailLevel,
}: {
  assigned: number;
  detailLevel: DetailLevel;
}) {
  const required = DETAIL_LEVEL_REQUIRED_EPOS[detailLevel];

  if (required === 0) {
    if (assigned > 0) {
      return (
        <span className="text-xs font-medium text-red-400">
          {assigned}/{required}
        </span>
      );
    }
    return (
      <span className="text-xs text-gray-500">
        {assigned} assigned
      </span>
    );
  }

  let color = "text-green-400";
  if (assigned === 0) color = "text-red-400";
  else if (assigned < required) color = "text-yellow-400";
  else if (assigned > required) color = "text-red-400";

  return (
    <span className={`text-xs font-medium ${color}`}>
      {assigned}/{required}
    </span>
  );
}
