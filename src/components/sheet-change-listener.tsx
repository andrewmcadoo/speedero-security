"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const REFRESH_LOCKOUT_MS = 500;

export function SheetChangeListener() {
  const router = useRouter();

  useEffect(() => {
    let refreshing = false;
    let pending = false;

    const runRefresh = () => {
      if (refreshing) {
        pending = true;
        return;
      }
      refreshing = true;
      router.refresh();
      window.setTimeout(() => {
        refreshing = false;
        if (pending) {
          pending = false;
          runRefresh();
        }
      }, REFRESH_LOCKOUT_MS);
    };

    // basePath is not auto-prefixed on EventSource; read from env so this
    // works both on Clipper (basePath="/SecApp") and any other host.
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const es = new EventSource(`${basePath}/api/changes`);
    es.addEventListener("changed", runRefresh);
    // Browser handles reconnect with backoff; nothing to do on error.

    return () => {
      es.close();
    };
  }, [router]);

  return null;
}
