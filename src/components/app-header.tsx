// src/components/app-header.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface AppHeaderProps {
  userName?: string;
  rightSlot?: React.ReactNode; // sign-out, bug-report, etc.
}

export function AppHeader({ userName, rightSlot }: AppHeaderProps) {
  const pathname = usePathname() ?? "";
  const onDashboard = pathname.startsWith("/dashboard");
  const onSops = pathname.startsWith("/sops");

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-gray-800 bg-gray-950/95 px-3 py-2 backdrop-blur">
      <nav className="flex items-center gap-1">
        <TabLink href="/dashboard" active={onDashboard}>
          Dashboard
        </TabLink>
        <TabLink href="/sops" active={onSops}>
          SOPs
        </TabLink>
      </nav>
      <div className="flex items-center gap-2 text-sm text-gray-400">
        {userName && <span className="hidden sm:inline">{userName}</span>}
        {rightSlot}
      </div>
    </header>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-md bg-blue-900/60 px-3 py-1.5 text-sm font-medium text-blue-200"
          : "rounded-md px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-gray-100"
      }
    >
      {children}
    </Link>
  );
}
