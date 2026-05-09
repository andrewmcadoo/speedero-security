// src/components/sop-viewer.tsx
"use client";

interface SopViewerProps {
  pdfUrl: string;
  downloadUrl: string;
  downloadFilename: string;
}

export function SopViewer({ pdfUrl, downloadUrl, downloadFilename }: SopViewerProps) {
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
        <a
          href={downloadUrl}
          download={downloadFilename}
          className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-blue-50 hover:bg-blue-600"
        >
          Download original
        </a>
      </div>
    </div>
  );
}
