"use client";

export function MissingCard() {
  return (
    <div
      className="rounded-lg border-l-3 border-gray-800 bg-gray-900/40 px-3 py-2 text-xs italic text-gray-500"
      title="No snapshot was captured for this date. The source row was likely deleted before the nightly snapshot or any dashboard load could capture it."
    >
      No card data captured for this date
    </div>
  );
}
