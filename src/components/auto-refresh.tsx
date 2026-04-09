"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function AutoRefresh({
  interval = 10000,
  children,
}: {
  interval?: number;
  children: React.ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), interval);
    return () => clearInterval(id);
  }, [router, interval]);

  return <>{children}</>;
}
