import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Users2, Boxes } from "lucide-react";
import { getParishStats, listParishes, parishBaseDomain } from "@parvaordo/core";
import { requireSuperAdmin } from "@/src/lib/require-role";
import { ParishStatusBadge } from "@/src/components/admin/parish-status-badge";
import { CustomDomainsForm, SubdomainForm } from "@/src/components/admin/edit-parish-forms";

export const dynamic = "force-dynamic";

export default async function ParishEditorPage({ params }: { params: Promise<{ parishId: string }> }) {
  const { parishId } = await params;
  const { userId } = await requireSuperAdmin();
  // No tenant-bypassing single-parish admin read exists, so resolve from the cross-tenant list.
  const parish = (await listParishes(userId)).find((p) => p.id === parishId);
  if (!parish) notFound();
  const stats = await getParishStats(userId, parishId);
  const baseDomain = parishBaseDomain();

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-sm text-navy/60 transition-colors hover:text-gold"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> All parishes
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-2xl text-navy">{parish.name}</h1>
          <ParishStatusBadge status={parish.status} />
        </div>
        <p className="mt-1 text-sm text-navy/55">
          {parish.slug}.{baseDomain}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Status" value={parish.status.replace("_", " ")} />
        <StatCard
          label="Members"
          value={stats ? String(stats.memberCount) : "—"}
          icon={<Users2 className="h-4 w-4" />}
        />
        <StatCard
          label="Groups"
          value={stats ? String(stats.ministryCount) : "—"}
          icon={<Boxes className="h-4 w-4" />}
        />
      </div>

      <section className="rounded-xl border border-navy/10 bg-white p-5 shadow-sm">
        <h2 className="font-heading text-lg text-navy">Parish name</h2>
        <p className="mt-1 text-sm text-navy/55">
          Set at creation. Renaming an existing parish is part of the first-admin handoff work and is not editable here
          yet.
        </p>
        <p className="mt-3 rounded-lg border border-navy/10 bg-cream/40 px-3 py-2 text-sm text-navy/70">
          {parish.name}
        </p>
      </section>

      <SubdomainForm parishId={parish.id} currentSlug={parish.slug} baseDomain={baseDomain} />
      <CustomDomainsForm parishId={parish.id} />
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-navy/10 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-navy/45">
        {icon}
        {label}
      </div>
      <p className="mt-1 font-heading text-xl capitalize text-navy">{value}</p>
    </div>
  );
}
