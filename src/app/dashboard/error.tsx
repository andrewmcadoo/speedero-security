"use client";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-gray-100">
          Something went wrong
        </h2>
        <p className="mt-1 text-sm text-gray-400">
          {error.message || "Failed to load dashboard data."}
        </p>
        <button
          onClick={reset}
          className="mt-4 rounded-md bg-gray-800 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
