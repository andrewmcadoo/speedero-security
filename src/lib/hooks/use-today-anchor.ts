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
 * Returns true when the referenced element is "off-screen above" the viewport,
 * with hysteresis to avoid feedback oscillation when the consumer's reaction
 * to off-screen state changes the element's position (e.g. revealing a banner
 * that grows the dashboard chrome and pushes the element back into view).
 *
 * - `showBelowPx`: while currently on-screen, transition to off-screen when
 *   the element's bottom edge drops below this y in viewport coordinates.
 *   Use 0 to mean "fully off-screen above".
 * - `hideAbovePx`: while currently off-screen, transition back to on-screen
 *   only when the element's bottom edge has come down past this y. Use a
 *   value larger than the chrome's banner growth so the element doesn't
 *   bounce back into view just from layout reflow.
 *
 * The gap between the two thresholds is the hysteresis band — pick it
 * larger than any layout shift the off-screen state itself causes.
 *
 * Plain scroll-event polling rather than IntersectionObserver because the
 * latter can't easily express asymmetric thresholds.
 */
export function useElementOffScreen(
  ref: React.RefObject<HTMLElement | null>,
  showBelowPx: number,
  hideAbovePx: number,
): boolean {
  const [offScreen, setOffScreen] = useState(false);

  useEffect(() => {
    function check() {
      const el = ref.current;
      if (!el) {
        setOffScreen(false);
        return;
      }
      const bottom = el.getBoundingClientRect().bottom;
      setOffScreen((prev) =>
        prev ? bottom <= hideAbovePx : bottom < showBelowPx,
      );
    }

    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check, { passive: true });
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [ref, showBelowPx, hideAbovePx]);

  return offScreen;
}

/** Helper: typed ref + initial null. Saves boilerplate at call sites. */
export function useAnchorRef<T extends HTMLElement = HTMLDivElement>() {
  return useRef<T | null>(null);
}

/**
 * Tracks an element's outer height via ResizeObserver. Returns 0 until the
 * element mounts, so callers must guard against the zero-state (otherwise
 * scroll-padding/thresholds would jump to 0 on first paint).
 *
 * Uses borderBoxSize so padding and borders are included — the consumer
 * generally wants "where is the bottom of this element," not its content box.
 */
export function useElementHeight(
  ref: React.RefObject<HTMLElement | null>,
): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      const box = entry.borderBoxSize?.[0];
      const h = box ? box.blockSize : entry.contentRect.height;
      setHeight(h);
    });
    ro.observe(el);
    setHeight(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, [ref]);

  return height;
}
