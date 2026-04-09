"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { DetailLevel } from "@/types/schedule";
import { DETAIL_LEVEL_LABELS } from "@/lib/detail-levels";

const LEVELS: DetailLevel[] = ["none", "single", "dual_day", "dual"];

export function DetailDropdown({
  date,
  initialValue,
  profileId,
}: {
  date: string;
  initialValue: DetailLevel;
  profileId: string;
}) {
  const [value, setValue] = useState<DetailLevel>(initialValue);
  const router = useRouter();

  // Sync local state when server data changes (e.g. after router.refresh())
  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const update = async (newValue: DetailLevel) => {
    // Optimistic update
    setValue(newValue);
    const supabase = createClient();
    const { error } = await supabase.from("date_settings").upsert(
      {
        date,
        detail_level: newValue,
        updated_by: profileId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "date" }
    );
    if (error) {
      console.error("Detail level save failed:", error);
      setValue(value); // Revert on failure
    } else {
      router.refresh();
    }
  };

  return (
    <div className="rounded-md bg-gray-950 px-2.5 py-1.5">
      <div className="text-[10px] text-gray-500 mb-0.5">DETAIL</div>
      <select
        className="w-full rounded bg-gray-950 px-2 py-1 text-xs text-gray-100 border border-gray-700 focus:border-blue-500 focus:outline-none"
        value={value}
        onChange={(e) => update(e.target.value as DetailLevel)}
      >
        {LEVELS.map((level) => (
          <option key={level} value={level}>
            {DETAIL_LEVEL_LABELS[level]}
          </option>
        ))}
      </select>
    </div>
  );
}
