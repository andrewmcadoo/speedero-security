import type { DetailLevel } from "@/types/schedule";

export const DETAIL_LEVEL_LABELS: Record<DetailLevel, string> = {
  none: "None",
  single: "Single",
  dual_day: "Dual Day",
  dual: "Dual",
};

export const DETAIL_LEVEL_REQUIRED_EPOS: Record<DetailLevel, number> = {
  none: 0,
  single: 1,
  dual_day: 2,
  dual: 2,
};
