// Route-level loading skeleton for the parish list (RFC-004 §13: a structured skeleton, never a
// spinner on blank). motion-safe gates the shimmer so prefers-reduced-motion gets a static skeleton.
export default function Loading() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="h-7 w-40 rounded bg-navy/10 motion-safe:animate-pulse" />
        <div className="h-4 w-64 rounded bg-navy/10 motion-safe:animate-pulse" />
      </div>
      <div className="h-44 rounded-xl border border-navy/10 bg-navy/5 motion-safe:animate-pulse" />
      <ul className="space-y-3">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-[68px] rounded-xl border border-navy/10 bg-navy/5 motion-safe:animate-pulse" />
        ))}
      </ul>
    </div>
  );
}
