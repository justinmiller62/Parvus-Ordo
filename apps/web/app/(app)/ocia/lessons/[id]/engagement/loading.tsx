/** Skeleton shown while the engagement summary aggregates (RSC streaming fallback). */
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 h-7 w-56 animate-pulse rounded bg-gray-100" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-lg border border-gray-200 bg-gray-50" />
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="h-48 animate-pulse rounded-lg border border-gray-200 bg-gray-50" />
        <div className="h-48 animate-pulse rounded-lg border border-gray-200 bg-gray-50" />
      </div>
      <div className="mt-6 h-64 animate-pulse rounded-lg border border-gray-200 bg-gray-50" />
    </div>
  );
}
