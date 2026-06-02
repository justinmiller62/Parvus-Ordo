"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Loader2, Plus, X } from "lucide-react";
import type { DioceseRow } from "@parvaordo/core";
import { type CreateParishState, checkSlugAction, createParishAction } from "@/app/(admin)/admin/actions";
import { CopyLinkButton } from "./copy-link-button";

type SlugState = { checking: boolean; available?: boolean; reason?: string };
const INITIAL: CreateParishState = { ok: false };

/**
 * Provision a bare parish (RFC-004 §12). Live subdomain preview + a debounced uniqueness probe
 * with a SPECIFIC reason (never a swallowed empty result); the create Server Action is the
 * authoritative gate. On success a toast offers the setup link to hand off. All motion is gated
 * behind motion-safe: so prefers-reduced-motion users get the same flow without animation.
 */
export function CreateParishForm({ dioceses, baseDomain }: { dioceses: DioceseRow[]; baseDomain: string }) {
  const [state, formAction, pending] = useActionState(createParishAction, INITIAL);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [dioceseId, setDioceseId] = useState("");
  const [slugState, setSlugState] = useState<SlugState>({ checking: false });
  const [created, setCreated] = useState<{ name: string; slug: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Debounced availability probe — advisory live feedback while the super-admin types.
  useEffect(() => {
    const s = slug.trim().toLowerCase();
    if (!s) {
      setSlugState({ checking: false });
      return;
    }
    setSlugState({ checking: true });
    const t = setTimeout(async () => {
      const r = await checkSlugAction(s);
      setSlugState({ checking: false, available: r.available, reason: r.reason });
    }, 400);
    return () => clearTimeout(t);
  }, [slug]);

  // On a successful create: surface the hand-off toast and clear the form for the next one.
  useEffect(() => {
    if (state.ok && state.parish) {
      setCreated({ name: state.parish.name, slug: state.parish.slug });
      setName("");
      setSlug("");
      setDioceseId("");
      setSlugState({ checking: false });
      formRef.current?.reset();
    }
  }, [state]);

  const knownTaken = slugState.available === false;
  const canSubmit = !pending && name.trim() && slug.trim() && dioceseId && !knownTaken;

  return (
    <section className="rounded-xl border border-navy/10 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 font-heading text-lg text-navy">
        <Plus className="h-4 w-4 text-gold" aria-hidden /> Provision a parish
      </h2>
      <p className="mt-1 text-sm text-navy/55">Creates a bare shell (pending setup) — no members or content yet.</p>

      <form ref={formRef} action={formAction} className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-navy">Parish name</span>
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Holy Spirit Parish"
            className="mt-1 w-full rounded-lg border border-navy/15 px-3 py-2 text-sm text-navy focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-navy">Diocese</span>
          <select
            name="dioceseId"
            value={dioceseId}
            onChange={(e) => setDioceseId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-navy/15 bg-white px-3 py-2 text-sm text-navy focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
          >
            <option value="">Choose a diocese…</option>
            {dioceses.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>

        <div className="sm:col-span-2">
          <span className="text-sm font-medium text-navy">Subdomain</span>
          <div className="relative mt-1">
            <input
              name="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="holy-spirit"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={knownTaken}
              className="w-full rounded-lg border border-navy/15 px-3 py-2 pr-9 text-sm text-navy focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2" aria-hidden>
              {slugState.checking ? (
                <Loader2 className="h-4 w-4 animate-spin text-navy/40" />
              ) : slugState.available === true ? (
                <Check className="h-4 w-4 text-emerald-600" />
              ) : knownTaken ? (
                <X className="h-4 w-4 text-rose-600" />
              ) : null}
            </span>
          </div>
          <p className="mt-1 text-xs text-navy/50" data-testid="slug-preview">
            Preview: <span className="font-medium text-navy/80">{slug.trim() || "your-parish"}</span>.{baseDomain}
          </p>
          {!slugState.checking && slugState.reason ? (
            <p className="mt-1 text-xs text-rose-600">{slugState.reason}</p>
          ) : slugState.available === true ? (
            <p className="mt-1 text-xs text-emerald-600">Available</p>
          ) : null}
        </div>

        {state.error ? (
          <p className="sm:col-span-2 flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden /> {state.error}
          </p>
        ) : null}

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded-lg bg-navy px-4 py-2 text-sm font-medium text-cream transition-colors hover:bg-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
            {pending ? "Provisioning…" : "Provision parish"}
          </button>
        </div>
      </form>

      {created ? (
        <CreatedToast
          name={created.name}
          url={`https://${created.slug}.${baseDomain}`}
          onDismiss={() => setCreated(null)}
        />
      ) : null}
    </section>
  );
}

/** Hand-off toast shown after a successful provision. Auto-dismisses; copy offers the parish link
 *  (the tokenized setup link is the first-admin handoff bead po-84jn). */
function CreatedToast({ name, url, onDismiss }: { name: string; url: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 9000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <div
      role="status"
      className="motion-safe:animate-[po-slide-up_0.3s_ease-out] fixed bottom-5 right-5 z-50 max-w-sm rounded-xl border border-gold/30 bg-navy px-4 py-3 text-cream shadow-lg"
    >
      <div className="flex items-start gap-3">
        <Check className="mt-0.5 h-5 w-5 shrink-0 text-gold" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium">{name} provisioned</p>
          <p className="mt-0.5 text-xs text-cream/70">Share the setup link so a parish admin can finish onboarding.</p>
          <div className="mt-2">
            <CopyLinkButton value={url} />
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="-mr-1 -mt-1 rounded p-1 text-cream/60 transition-colors hover:text-cream"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
