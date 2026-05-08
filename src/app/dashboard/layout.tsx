import type { ReactNode } from "react";
import { SheetChangeListener } from "@/components/sheet-change-listener";

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      <SheetChangeListener />
      {children}
    </>
  );
}
