"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Scroll the referenced element into view at the top of the scrollable region.
 *
 * - On mount and whenever `deps` change, if `ref.current` is non-null, do an
 *   instant scroll to the element. Used for initial anchor + re-anchor on
 *   filter/range change.
 * - The `jumpToToday` returned function does a SMOOTH scroll. Used by the
 *   banner click — distinct UX from the silent initial anchor.
 * - The sticky-stack offset is handled via `scroll-margin-top` set in CSS on
 *   the anchor element (see TASK_4 wiring). Keeping pixel math out of JS
 *   means the hook stays DOM-agnostic.
 *
 * No-op when ref is null (today not in current filter result).
 */
export function useTodayAnchor(
  ref: React.RefObject<HTMLElement | null>,
  deps: ReadonlyArray<unknown>,
): { jumpToToday: () => void } {
  // Auto-anchor on mount + dep change.
  useEffect(() => {
    if (!ref.current) return;
    ref.current.scrollIntoView({ block: "start", behavior: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const jumpToToday = useCallback(() => {
    if (!ref.current) return;
    ref.current.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [ref]);

  return { jumpToToday };
}

/**
 * Returns true when the referenced element is NOT intersecting the viewport.
 *
 * `topOffsetPx` shrinks the effective viewport from the top so an element
 * that's behind the sticky header/filter chrome counts as "off-screen."
 *
 * Returns `false` until the first observer callback fires (avoids a flash
 * of the banner before we know the answer).
 */
export function useElementOffScreen(
  ref: React.RefObject<HTMLElement | null>,
  topOffsetPx: number,
): boolean {
  const [offScreen, setOffScreen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setOffScreen(!entry.isIntersecting);
      },
      {
        // Negative top inset: the element must be visible BELOW the sticky
        // chrome to count as "intersecting".
        rootMargin: `-${topOffsetPx}px 0px 0px 0px`,
        threshold: 0,
      },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, topOffsetPx]);

  return offScreen;
}

/** Helper: typed ref + initial null. Saves boilerplate at call sites. */
export function useAnchorRef<T extends HTMLElement = HTMLDivElement>() {
  return useRef<T | null>(null);
}
