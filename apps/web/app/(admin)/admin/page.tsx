import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { type AdminParish, listDioceses, listParishes, parishBaseDomain } from "@parvaordo/core";
import { requireSuperAdmin } from "@/src/lib/require-role";
import { CreateParishForm } from "@/src/components/admin/create-parish-form";
import { ParishStatusBadge } from "@/src/components/admin/parish-status-badge";

export const dynamic = "force-dynamic";

export default async function AdminParishesPage() {
  // Re-assert here too (request-cached, so free alongside the layout's gate) to get the actor id.
  const { userId } = await requireSuperAdmin();
  const [parishes, dioceses] = await Promise.all([listParishes(userId), listDioceses()]);
  const baseDomain = parishBaseDomain();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl text-navy">Parishes</h1>
        <p className="mt-1 text-sm text-navy/60">
          {parishes.length === 0
            ? "Provision the first parish to get started."
            : `${parishes.length} ${parishes.length === 1 ? "parish" : "parishes"} across the platform.`}
        </p>
      </div>

      <CreateParishForm dioceses={dioceses} baseDomain={baseDomain} />

      {parishes.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-3">
          {parishes.map((p, i) => (
            <ParishRow key={p.id} parish={p} baseDomain={baseDomain} index={i} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="motion-safe:animate-[po-fade-in_0.4s_ease-out] rounded-xl border border-dashed border-gold/40 bg-cream/40 px-6 py-12 text-center">
      <p className="font-heading text-lg text-navy">No parishes yet</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-navy/60">
        Create the first parish above — it provisions a bare shell you can hand off with a setup link.
      </p>
    </div>
  );
}

function ParishRow({ parish, baseDomain, index }: { parish: AdminParish; baseDomain: string; index: number }) {
  return (
    <li
      className="motion-safe:animate-[po-fade-in_0.4s_ease-out] motion-safe:[animation-fill-mode:backwards]"
      style={{ animationDelay: `${Math.min(index * 40, 320)}ms` }}
    >
      <Link
        href={`/admin/${parish.id}`}
        className="group flex items-center justify-between gap-4 rounded-xl border border-navy/10 bg-white px-5 py-4 shadow-sm transition-all hover:border-gold/50 hover:shadow-md"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="truncate font-medium text-navy">{parish.name}</span>
            <ParishStatusBadge status={parish.status} />
          </div>
          <p className="mt-0.5 truncate text-sm text-navy/50">
            {parish.slug}.{baseDomain}
          </p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-navy/30 transition-transform group-hover:translate-x-0.5 group-hover:text-gold" />
      </Link>
    </li>
  );
}
