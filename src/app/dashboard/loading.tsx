export default function DashboardLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="h-6 w-48 animate-pulse rounded bg-gray-800" />
          <div className="mt-2 h-4 w-32 animate-pulse rounded bg-gray-800" />
        </div>
        <div className="h-8 w-20 animate-pulse rounded bg-gray-800" />
      </div>
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="space-y-2">
            <div className="h-8 animate-pulse rounded-md bg-gray-900" />
            <div className="h-16 animate-pulse rounded-lg bg-gray-800/80" />
          </div>
        ))}
      </div>
    </div>
  );
}
