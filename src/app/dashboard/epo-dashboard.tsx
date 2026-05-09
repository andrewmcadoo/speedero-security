"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useSearchParams } from "next/navigation";
import type { DashboardEntry } from "@/types/schedule";
import { SignOutButton } from "@/components/sign-out-button";
import { ReportBugButton } from "@/components/report-bug-button";
import { DateHeader } from "@/components/date-header";
import { ScheduleDetailCard } from "@/components/schedule-detail-card";
import { DashboardFilters } from "@/components/dashboard-filters";
import { readFilterFromSearch } from "@/lib/dashboard/filter-url";
import { findAnchorDate } from "@/lib/dashboard/today-anchor";
import {
  useAnchorRef,
  useElementHeight,
  useElementOffScreen,
  useTodayAnchor,
} from "@/lib/hooks/use-today-anchor";
import { TodayBanner } from "@/components/today-banner";
import { AppHeader } from "@/components/app-header";

// Hysteresis above current chrome bottom — must exceed the chrome's growth
// when the banner appears (~36px) so the reveal doesn't shift today back into
// view and re-hide the banner.
const HIDE_BUFFER = 36;
// Used until ResizeObserver reports a real chrome height on first paint.
const FALLBACK_CHROME = 128;

const EPO_FILTERS = [
  { value: "all" as const, label: "My Assignments" },
  { value: "this-week" as const, label: "This Week" },
  { value: "next-week" as const, label: "Next Week" },
  { value: "past-assignments" as const, label: "Past Assignments" },
];

export function EpoDashboard({
  entries,
  assignedDates,
  userName,
  todayISO,
  tomorrowISO,
  range,
}: {
  entries: DashboardEntry[];
  assignedDates: string[];
  userName: string;
  todayISO: string;
  tomorrowISO: string;
  range: { start: string; end: string };
}) {
  const firstName = (userName ?? "").trim().split(/\s+/)[0] || "";
  const [search, setSearch] = useState("");
  const params = useSearchParams();
  // Filter is URL-derived. Pill clicks update URL via replaceState (or
  // router.push when a custom range needs to be dropped); useSearchParams
  // is reactive to both, so this stays in sync without local state.
  const filter = readFilterFromSearch(params.toString());

  const filtered = useMemo(() => {
    let result = entries.filter((e) => assignedDates.includes(e.date));

    switch (filter) {
      case "all":
        result = result.filter((e) => !e.isPast);
        break;
      case "this-week":
        result = result.filter((e) => e.isThisWeek);
        break;
      case "next-week":
        result = result.filter((e) => e.isNextWeek);
        break;
      case "past-assignments":
        result = result.filter((e) => e.isPast);
        break;
    }

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.activity.toLowerCase().includes(q) ||
          e.location.toLowerCase().includes(q)
      );
    }

    return result;
  }, [entries, filter, search, assignedDates]);

  const anchor = useMemo(
    () => findAnchorDate(filtered, todayISO),
    [filtered, todayISO],
  );
  const anchorRef = useAnchorRef<HTMLDivElement>();
  const { jumpToToday } = useTodayAnchor(anchorRef, [
    anchor.date,
    filtered.length,
    filter,
  ]);

  // Measure the chrome so snap-padding and banner-visibility thresholds match
  // the actual rendered height. On mobile the filter row wraps, so a hardcoded
  // 128/164 leaves cards partly hidden behind the chrome on snap.
  const chromeRef = useRef<HTMLDivElement | null>(null);
  const chromeHeight = useElementHeight(chromeRef);
  // Suppress the banner during the post-click smooth scroll. flushSync hides
  // the banner synchronously so the chrome shrinks BEFORE scrollIntoView
  // computes its target — otherwise the chrome would shrink mid-animation
  // and today would land partially behind the chrome line.
  const [scrolling, setScrolling] = useState(false);
  // Banner only listens when the anchor IS today. When the anchor is the
  // next-upcoming card, there is no "today" to jump to.
  // Thresholds track the live chrome height: once banner reveals, chrome
  // grows by ~36 and so does hideAbove, keeping the post-reveal card bottom
  // safely below it without flapping.
  const liveChrome = chromeHeight || FALLBACK_CHROME;
  const todayCardOffScreen = useElementOffScreen(
    anchor.isToday ? anchorRef : { current: null },
    liveChrome,
    liveChrome + HIDE_BUFFER,
  );
  const handleJump = useCallback(() => {
    flushSync(() => setScrolling(true));
    jumpToToday();
    setTimeout(() => setScrolling(false), 800);
  }, [jumpToToday]);
  const bannerVisible = anchor.isToday && todayCardOffScreen && !scrolling;

  // Always write --snap-pad — even before the first measurement we set the
  // fallback so scroll-padding-top never silently uses the CSS default
  // (which on mobile undershoots actual chrome and lets cards land hidden).
  useEffect(() => {
    const px = chromeHeight > 0 ? chromeHeight : FALLBACK_CHROME;
    document.documentElement.style.setProperty("--snap-pad", `${px}px`);
  }, [chromeHeight]);
  useEffect(() => {
    return () => {
      document.documentElement.style.removeProperty("--snap-pad");
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-6">
      <div
        ref={chromeRef}
        data-chrome-h={chromeHeight || undefined}
        className="sticky top-0 z-30 bg-gray-950 pb-2 pt-[max(1.5rem,env(safe-area-inset-top))]"
      >
        <div className="mb-2">
          <h1 className="text-xl font-bold">Speedero Security</h1>
          <p className="text-sm text-gray-400">
            {firstName ? `${firstName}'s Assignment Schedule` : "Assignment Schedule"}
          </p>
        </div>
        <AppHeader
          userName={userName}
          rightSlot={
            <>
              <ReportBugButton />
              <SignOutButton />
            </>
          }
        />
        <div>
          <DashboardFilters
            searchQuery={search}
            onSearchChange={setSearch}
            filters={EPO_FILTERS}
            range={range}
          />
        </div>
        {/* Banner lives inside the chrome flow so cards push down when it
            appears (no overlap). max-height transition smooths the chrome
            growth/shrink so the cards slide rather than jump. */}
        <div
          className={`overflow-hidden transition-[max-height] duration-300 ease-out ${
            bannerVisible ? "max-h-9" : "max-h-0"
          }`}
        >
          <div className="pt-2">
            <TodayBanner
              todayISO={todayISO}
              tomorrowISO={tomorrowISO}
              visible={true}
              onJumpToToday={handleJump}
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-20 text-center">
          <p className="text-lg text-gray-500">
            {entries.length === 0
              ? "No assigned dates"
              : "No matching entries"}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            {entries.length === 0
              ? "Check back later or contact your supervisor."
              : "Try adjusting your filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((entry) => {
            const isAnchor = entry.date === anchor.date;
            return (
              <div
                key={entry.date}
                ref={isAnchor ? anchorRef : undefined}
                className="snap-start space-y-2"
              >
                <DateHeader
                  dateStr={entry.date}
                  status={entry.confirmationStatus}
                  todayISO={todayISO}
                  tomorrowISO={tomorrowISO}
                />
                <ScheduleDetailCard entry={entry} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
