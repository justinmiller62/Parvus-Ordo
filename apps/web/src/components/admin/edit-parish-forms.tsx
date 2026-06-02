"use client";

import { useActionState, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { type EditState, setCustomDomainsAction, setSubdomainAction } from "@/app/(admin)/admin/actions";

const INITIAL: EditState = { ok: false };

function Feedback({ state }: { state: EditState }) {
  if (state.error)
    return (
      <p className="mt-2 flex items-center gap-1.5 text-sm text-rose-600">
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden /> {state.error}
      </p>
    );
  if (state.ok && state.message)
    return (
      <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-600">
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> {state.message}
      </p>
    );
  return null;
}

export function SubdomainForm({
  parishId,
  currentSlug,
  baseDomain,
}: {
  parishId: string;
  currentSlug: string;
  baseDomain: string;
}) {
  const [state, action, pending] = useActionState(setSubdomainAction, INITIAL);
  const [slug, setSlug] = useState(currentSlug);
  const changed = slug.trim().toLowerCase() !== currentSlug;

  return (
    <section className="rounded-xl border border-navy/10 bg-white p-5 shadow-sm">
      <h2 className="font-heading text-lg text-navy">Subdomain</h2>
      <form action={action} className="mt-3">
        <input type="hidden" name="parishId" value={parishId} />
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="sr-only">Subdomain slug</span>
            <input
              name="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              autoCapitalize="none"
              spellCheck={false}
              className="w-56 rounded-lg border border-navy/15 px-3 py-2 text-sm text-navy focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
            />
          </label>
          <span className="pb-2 text-sm text-navy/50">.{baseDomain}</span>
          <button
            type="submit"
            disabled={pending || !changed || !slug.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-navy px-3.5 py-2 text-sm font-medium text-cream transition-colors hover:bg-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Save
          </button>
        </div>
        <Feedback state={state} />
      </form>
    </section>
  );
}

export function CustomDomainsForm({ parishId }: { parishId: string }) {
  const [state, action, pending] = useActionState(setCustomDomainsAction, INITIAL);
  return (
    <section className="rounded-xl border border-navy/10 bg-white p-5 shadow-sm">
      <h2 className="font-heading text-lg text-navy">Custom domains</h2>
      <p className="mt-1 text-sm text-navy/55">
        Replaces the parish’s full custom-domain list — one hostname per line (e.g.{" "}
        <span className="text-navy/70">holyspirit.org</span>). Leave empty to clear.
      </p>
      <form action={action} className="mt-3">
        <input type="hidden" name="parishId" value={parishId} />
        <textarea
          name="domains"
          rows={3}
          placeholder={"holyspirit.org\nwww.holyspirit.org"}
          autoCapitalize="none"
          spellCheck={false}
          className="w-full rounded-lg border border-navy/15 px-3 py-2 text-sm text-navy focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
        />
        <div className="mt-2">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-navy px-3.5 py-2 text-sm font-medium text-cream transition-colors hover:bg-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Save domains
          </button>
        </div>
        <Feedback state={state} />
      </form>
    </section>
  );
}
