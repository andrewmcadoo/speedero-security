"use client";

import { setDetailLevelWithNotify } from "@/app/dashboard/actions";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { DetailLevel } from "@/types/schedule";
import { DETAIL_LEVEL_LABELS } from "@/lib/detail-levels";
import { DetailChangeDialog } from "./detail-change-dialog";

const LEVELS: DetailLevel[] = ["none", "single", "dual_day", "dual"];

export function DetailDropdown({
  date,
  initialValue,
}: {
  date: string;
  initialValue: DetailLevel;
}) {
  const [value, setValue] = useState<DetailLevel>(initialValue);
  const [pending, setPending] = useState<DetailLevel | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  // Auto-clear inline error after 5s.
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(id);
  }, [error]);

  const handleConfirm = async (notify: boolean) => {
    if (pending == null) return;
    setSaving(true);
    setError(null);
    const result = await setDetailLevelWithNotify(date, pending, notify);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      setPending(null);
      return;
    }
    setValue(pending);
    setPending(null);
    if (result.emailError) {
      setError(`Detail saved. ${result.emailError}.`);
    }
    router.refresh();
  };

  return (
    <div className="rounded-md bg-gray-950 px-2.5 py-1.5">
      <div className="text-[10px] text-gray-500 mb-0.5">DETAIL</div>
      <select
        className="w-full rounded bg-gray-950 px-2 py-1 text-xs text-gray-100 border border-gray-700 focus:border-blue-500 focus:outline-none"
        value={value}
        onChange={(e) => setPending(e.target.value as DetailLevel)}
      >
        {LEVELS.map((level) => (
          <option key={level} value={level}>
            {DETAIL_LEVEL_LABELS[level]}
          </option>
        ))}
      </select>
      {error && (
        <p
          role="alert"
          className="mt-1 text-[10px] text-red-400"
        >
          {error}
        </p>
      )}
      <DetailChangeDialog
        open={pending != null}
        date={date}
        oldLevel={value}
        newLevel={pending ?? value}
        loading={saving}
        onConfirm={handleConfirm}
        onCancel={() => {
          if (saving) return;
          setPending(null);
        }}
      />
    </div>
  );
}
