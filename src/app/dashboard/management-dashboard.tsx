"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { useSearchParams } from "next/navigation";
import type { DashboardEntry } from "@/types/schedule";
import { SignOutButton } from "@/components/sign-out-button";
import { ReportBugButton } from "@/components/report-bug-button";
import { DateHeader } from "@/components/date-header";
import { ManagementCard } from "@/components/management-card";
import { DashboardFilters } from "@/components/dashboard-filters";
import { readFilterFromSearch } from "@/lib/dashboard/filter-url";
import { findAnchorDate } from "@/lib/dashboard/today-anchor";
import {
  useAnchorRef,
  useElementOffScreen,
  useTodayAnchor,
} from "@/lib/hooks/use-today-anchor";
import { TodayBanner } from "@/components/today-banner";
import Link from "next/link";

export function ManagementDashboard({
  entries,
  epos,
  profileId,
  todayISO,
  tomorrowISO,
  range,
}: {
  entries: DashboardEntry[];
  epos: { id: string; fullName: string; email: string }[];
  profileId: string;
  todayISO: string;
  tomorrowISO: string;
  range: { start: string; end: string };
}) {
  const [search, setSearch] = useState("");
  const params = useSearchParams();
  const filter = readFilterFromSearch(params.toString());

  const filtered = useMemo(() => {
    let result = entries;

    switch (filter) {
      case "unassigned":
        result = result.filter((e) => e.assignedEpos.length === 0);
        break;
      case "this-week":
        result = result.filter((e) => e.isThisWeek);
        break;
      case "next-week":
        result = result.filter((e) => e.isNextWeek);
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
  }, [entries, filter, search]);

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
  const todayCardOffScreen = useElementOffScreen(
    anchor.isToday ? anchorRef : { current: null },
    128,  // showBelowPx — banner appears once today is fully behind the chrome (chrome bottom = 128)
    200,  // hideAbovePx — only hide once today is well back below chrome+banner (164) plus a buffer
  );
  // Suppress the banner during the post-click smooth scroll. flushSync hides
  // the banner synchronously so the chrome shrinks BEFORE scrollIntoView
  // computes its target.
  const [scrolling, setScrolling] = useState(false);
  const handleJump = useCallback(() => {
    flushSync(() => setScrolling(true));
    jumpToToday();
    setTimeout(() => setScrolling(false), 800);
  }, [jumpToToday]);
  const bannerVisible = anchor.isToday && todayCardOffScreen && !scrolling;
  // Sync html scroll-padding-top with chrome height (transitioned in CSS).
  useEffect(() => {
    const html = document.documentElement;
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
            <p className="text-sm text-gray-400">Management Dashboard</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/users"
              className="rounded-md px-3 py-1.5 text-xs text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
            >
              Manage Users
            </Link>
            <ReportBugButton />
            <SignOutButton />
          </div>
        </header>
        <div>
          <DashboardFilters
            searchQuery={search}
            onSearchChange={setSearch}
            range={range}
          />
        </div>
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
              ? "No schedule data"
              : "No matching entries"}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            {entries.length === 0
              ? "Check your Google Sheets connection."
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
                <ManagementCard
                  entry={entry}
                  allEpos={epos}
                  profileId={profileId}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
