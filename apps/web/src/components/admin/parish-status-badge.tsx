import type { ParishStatus } from "@parvaordo/shared";

// Lifecycle status chip, color-coded. Pure/presentational (no client JS) — shared by the parish
// list and the editor header.
const STYLES: Record<ParishStatus, { label: string; cls: string }> = {
  pending_setup: { label: "Pending setup", cls: "bg-gold/15 text-gold-dark ring-gold/30" },
  active: { label: "Active", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  suspended: { label: "Suspended", cls: "bg-rose-50 text-rose-700 ring-rose-600/20" },
};

export function ParishStatusBadge({ status }: { status: ParishStatus }) {
  const s = STYLES[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}
    >
      {s.label}
    </span>
  );
}
