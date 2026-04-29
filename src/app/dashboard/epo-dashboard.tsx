"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  useElementOffScreen,
  useTodayAnchor,
} from "@/lib/hooks/use-today-anchor";
import { TodayBanner } from "@/components/today-banner";

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
  // Banner only listens when the anchor IS today. When the anchor is the
  // next-upcoming card, there is no "today" to jump to.
  const todayCardOffScreen = useElementOffScreen(
    anchor.isToday ? anchorRef : { current: null },
    128,  // showBelowPx — banner appears once today is fully behind the chrome (chrome bottom = 128)
    200,  // hideAbovePx — only hide once today is well back below chrome+banner (164) plus a buffer
  );
  // Suppress the banner during the post-click smooth scroll. flushSync hides
  // the banner synchronously so the chrome shrinks BEFORE scrollIntoView
  // computes its target — otherwise the chrome would shrink mid-animation
  // and today would land partially behind the chrome line.
  const [scrolling, setScrolling] = useState(false);
  const handleJump = useCallback(() => {
    flushSync(() => setScrolling(true));
    jumpToToday();
    setTimeout(() => setScrolling(false), 800);
  }, [jumpToToday]);
  const bannerVisible = anchor.isToday && todayCardOffScreen && !scrolling;
  // Keep the html-level snap padding in sync with chrome height. The CSS
  // transition on scroll-padding-top in globals.css smooths the change so
  // snap targets follow the chrome bottom without judder.
  useEffect(() => {
    const html = document.documentElement;
    // Chrome height ≈ 128px (banner hidden) or 164px (banner shown).
    html.style.setProperty("--snap-pad", bannerVisible ? "164px" : "128px");
    return () => {
      html.style.removeProperty("--snap-pad");
    };
  }, [bannerVisible]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-6">
      <div className="sticky top-0 z-30 bg-gray-950 pt-6 pb-2">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Speedero Security</h1>
            <p className="text-sm text-gray-400">
              {firstName ? `${firstName}'s Assignment Schedule` : "Assignment Schedule"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ReportBugButton />
            <SignOutButton />
          </div>
        </header>
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
