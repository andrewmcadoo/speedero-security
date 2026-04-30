"use client";

import { useEffect, useRef, useState } from "react";
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
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handler(ev: MouseEvent) {
      if (!containerRef.current) return;
      if (containerRef.current.contains(ev.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function applyRange(next: DateRange) {
    const sp = new URLSearchParams(params.toString());
    sp.set("start", next.start);
    sp.set("end", next.end);
    sp.delete("date");
    sp.delete("filter");
    router.push(`${pathname}?${sp.toString()}`);
    setOpen(false);
  }

  const hasCustomRange = params.has("start") || params.has("end") || params.has("date");
  const triggerActive = open || hasCustomRange;

  return (
    <div ref={containerRef} className="relative">
      <div className="inline-flex items-center overflow-hidden rounded-md bg-gray-800 ring-1 ring-gray-700">
        <button
          onClick={() => setOpen(!open)}
          className={`px-2 py-1.5 text-xs transition-colors border-r border-gray-700 ${
            triggerActive ? "bg-blue-700 text-white" : "text-gray-400 hover:bg-gray-700"
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
        <PopoverContents
          range={range}
          onApply={applyRange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const WEEKDAYS = ["S","M","T","W","T","F","S"];

interface MonthGridProps {
  /** First-of-month for the displayed page, ISO YYYY-MM-01. */
  monthStart: string;
  range: DateRange;
  onDayClick: (iso: string) => void;
}

function pad(n: number): string { return String(n).padStart(2, "0"); }

function MonthGrid({ monthStart, range, onDayClick }: MonthGridProps) {
  const [yearStr, monthStr] = monthStart.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr); // 1-based
  const firstWeekdayUtc = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0..6
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  // Build a flat array of cells: leading blanks + days.
  const cells: ({ iso: string; day: number } | null)[] = [];
  for (let i = 0; i < firstWeekdayUtc; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ iso: `${year}-${pad(month)}-${pad(d)}`, day: d });
  }

  function classFor(iso: string): string {
    const isStart = iso === range.start;
    const isEnd = iso === range.end;
    const inRange = iso > range.start && iso < range.end;
    if (isStart && isEnd) return "bg-blue-600 text-white rounded";
    if (isStart) return "bg-blue-600 text-white rounded-l";
    if (isEnd) return "bg-blue-600 text-white rounded-r";
    if (inRange) return "bg-blue-900 text-blue-100";
    return "text-gray-400 hover:bg-gray-800 rounded";
  }

  return (
    <div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-gray-500 mb-1">
        {WEEKDAYS.map((w, i) => (<div key={i}>{w}</div>))}
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
        {cells.map((c, i) => c === null ? (
          <div key={`blank-${i}`} />
        ) : (
          <button
            key={c.iso}
            onClick={() => onDayClick(c.iso)}
            className={`py-1 ${classFor(c.iso)}`}
          >
            {c.day}
          </button>
        ))}
      </div>
    </div>
  );
}

function PopoverContents({
  range,
  onApply,
  onClose,
}: {
  range: DateRange;
  onApply: (next: DateRange) => void;
  onClose: () => void;
}) {
  const [monthStart, setMonthStart] = useState(() => {
    const [y, m] = range.start.split("-");
    return `${y}-${m}-01`;
  });
  // pendingStart=null means "next click sets start"; pendingStart!=null
  // means "next click sets end" (Kayak-style two-click range).
  const [pendingStart, setPendingStart] = useState<string | null>(null);

  function shiftMonth(delta: number) {
    const [y, m] = monthStart.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonthStart(`${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-01`);
  }

  function handleDayClick(iso: string) {
    if (pendingStart === null) {
      // First click: stash the pending start in local state. Do NOT call
      // onApply yet — that would navigate (router.push) and unmount this
      // popover, losing pendingStart and breaking the second click. The
      // 1-day visualization comes from `displayRange` below.
      setPendingStart(iso);
      return;
    }
    // Second click: complete the range. Swap if user clicked earlier.
    const start = pendingStart < iso ? pendingStart : iso;
    const end = pendingStart < iso ? iso : pendingStart;
    setPendingStart(null);
    onApply({ start, end });
    onClose();
  }

  const [year, mm] = monthStart.split("-");
  const monthLabel = `${MONTH_NAMES[Number(mm) - 1]} ${year}`;
  const displayRange = pendingStart !== null
    ? { start: pendingStart, end: pendingStart }
    : range;

  return (
    <div className="absolute left-0 top-full z-10 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-md bg-gray-900 p-3 shadow-lg ring-1 ring-gray-700 sm:left-auto sm:right-0">
      <div className="mb-2 flex items-center justify-between">
        <button onClick={() => shiftMonth(-1)} className="px-2 text-gray-400 hover:text-gray-100">‹</button>
        <div className="text-xs font-semibold text-gray-200">{monthLabel}</div>
        <button onClick={() => shiftMonth(1)} className="px-2 text-gray-400 hover:text-gray-100">›</button>
      </div>
      <MonthGrid
        monthStart={monthStart}
        range={displayRange}
        onDayClick={handleDayClick}
      />
      <PresetRow onPick={(r) => { setPendingStart(null); onApply(r); onClose(); }} />
      <div className="mt-1 text-center text-[10px] text-gray-600">
        {pendingStart === null ? "Click to set start" : "Click to set end"}
      </div>
    </div>
  );
}

function todayIso(): string {
  // The popover runs in the browser; TZ-correct enough for human selection
  // (the server is the authority on `today` for filtering).
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function addDaysBrowser(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function dayOfWeekBrowser(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function PresetRow({ onPick }: { onPick: (r: DateRange) => void }) {
  const t = todayIso();
  const sunThis = addDaysBrowser(t, -dayOfWeekBrowser(t));
  const sunLast = addDaysBrowser(sunThis, -7);
  const presets: { label: string; range: DateRange }[] = [
    { label: "Today",        range: { start: t, end: t } },
    { label: "This week",    range: { start: sunThis, end: addDaysBrowser(sunThis, 6) } },
    { label: "Last week",    range: { start: sunLast, end: addDaysBrowser(sunLast, 6) } },
    { label: "Past 30 days", range: { start: addDaysBrowser(t, -30), end: addDaysBrowser(t, -1) } },
  ];
  return (
    <div className="mt-3 grid grid-cols-2 gap-1">
      {presets.map((p) => (
        <button
          key={p.label}
          onClick={() => onPick(p.range)}
          className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
