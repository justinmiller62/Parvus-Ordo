import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { getParishApplyInfo, listApplicationParishes, resolveParishIdForHost } from "@parvaordo/core";
import { getBrand } from "@/src/lib/brand";
import { ApplyForm } from "./apply-form";

/**
 * Public, unauthenticated OCIA inquiry page (lives outside the (app) group, so no
 * auth gate). Parish is resolved from the request hostname (subdomain → slug); on
 * the apex it shows a picker of parishes accepting applications, and selecting one
 * carries `?parish=<id>`.
 */
export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ parish?: string }> }) {
  const brand = await getBrand();
  const sp = await searchParams;
  const host = (await headers()).get("host");
  const parishId = (await resolveParishIdForHost(host)) ?? (sp.parish || null);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <Image
          src={brand.logoSrc}
          alt={brand.name}
          width={120}
          height={178}
          priority
          className="mx-auto h-auto w-24 rounded-lg"
        />
        <p className="mt-3 mb-6 font-heading text-sm tracking-wide text-burgundy">{brand.tagline}</p>
        {await renderBody(parishId)}
      </div>
    </main>
  );
}

async function renderBody(parishId: string | null) {
  if (parishId) {
    const info = await getParishApplyInfo(parishId);
    if (!info) return <Closed name="this parish" />;
    if (!info.applicationsEnabled) return <Closed name={info.name} />;
    return <ApplyForm parishId={parishId} parishName={info.name} />;
  }

  // Apex / no subdomain → pick a parish.
  const parishes = await listApplicationParishes();
  if (parishes.length === 0) return <Closed name="any parish" />;
  return (
    <div className="rounded-xl border border-navy/10 bg-cream/40 p-6 text-center shadow-sm" data-testid="apply-picker">
      <h1 className="text-xl text-navy">Choose your parish</h1>
      <p className="mt-1 mb-4 text-sm text-navy/60">Select the parish you&apos;d like to inquire about.</p>
      <ul className="space-y-2 text-left">
        {parishes.map((p) => (
          <li key={p.id}>
            <Link
              href={`/apply?parish=${p.id}`}
              data-testid={`apply-pick-${p.id}`}
              className="block rounded-md border border-navy/15 bg-white px-3 py-2 text-sm font-medium text-navy hover:border-gold hover:bg-gold/5"
            >
              {p.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Closed({ name }: { name: string }) {
  return (
    <div className="rounded-xl border border-navy/10 bg-cream/40 p-6 text-center shadow-sm" data-testid="apply-closed">
      <h1 className="text-xl text-navy">Applications are closed</h1>
      <p className="mt-3 text-sm text-navy/70">
        {name} is not accepting new OCIA inquiries online right now. Please contact the parish office.
      </p>
    </div>
  );
}
