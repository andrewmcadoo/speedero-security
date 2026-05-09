// src/components/sop-viewer.tsx
"use client";

import Link from "next/link";

interface SopViewerProps {
  pdfUrl: string;
}

export function SopViewer({ pdfUrl }: SopViewerProps) {
  return (
    <div className="flex flex-col">
      <div className="aspect-[3/4] w-full sm:aspect-auto sm:h-[80vh]">
        <iframe
          src={pdfUrl}
          title="SOP document"
          className="h-full w-full rounded-lg border border-gray-800 bg-white"
        />
      </div>
      <div className="mt-3 flex justify-end">
        <Link
          href="/sops"
          className="rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-gray-100 hover:bg-gray-700"
        >
          Close
        </Link>
      </div>
    </div>
  );
}
