"use client";

import { useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { DateRange } from "@/lib/dashboard/range";

function formatLabel(range: DateRange): string {
  const fmt = (iso: string) => {
    const [, m, d] = iso.split("-");
    const month = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(m) - 1];
    return `${month} ${Number(d)}`;
  };
  if (range.start === range.end) return fmt(range.start);
  return `${fmt(range.start)} → ${fmt(range.end)}`;
}

export function DateRangeControl({ range }: { range: DateRange }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function applyRange(next: DateRange) {
    const sp = new URLSearchParams(params.toString());
    sp.set("start", next.start);
    sp.set("end", next.end);
    sp.delete("date");
    router.push(`${pathname}?${sp.toString()}`);
    setOpen(false);
  }

  return (
    <div className="relative">
      <div className="inline-flex items-center overflow-hidden rounded-md bg-gray-800 ring-1 ring-gray-700">
        <button
          onClick={() => setOpen(!open)}
          className={`px-2 py-1.5 text-xs transition-colors border-r border-gray-700 ${
            open ? "bg-blue-700 text-white" : "text-gray-400 hover:bg-gray-700"
          }`}
          aria-label="Toggle date picker"
        >
          📅
        </button>
        <button
          onClick={() => setOpen(true)}
          className="px-2.5 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
        >
          {formatLabel(range)}
        </button>
      </div>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-72 rounded-md bg-gray-900 p-3 shadow-lg ring-1 ring-gray-700">
          <div className="text-xs text-gray-400">
            Calendar grid lands in Task 18.
          </div>
          {/* TEMP — remove in Task 18: */}
          <button
            onClick={() => applyRange({ start: range.start, end: range.end })}
            className="mt-2 rounded bg-blue-700 px-2 py-1 text-xs text-white"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
