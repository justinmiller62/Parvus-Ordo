"use client";

import { useActionState, useState } from "react";
import { type ApplyState, submitApplicationAction } from "./actions";

const INPUT =
  "mt-1 w-full rounded-md border border-navy/15 bg-white px-3 py-2 text-sm text-navy focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";
const LABEL = "block text-left text-sm font-medium text-navy";

const initial: ApplyState = { ok: false };

export function ApplyForm({ parishId, parishName }: { parishId: string; parishName: string }) {
  const [state, formAction, pending] = useActionState(submitApplicationAction, initial);
  const [baptized, setBaptized] = useState("");
  const [tradition, setTradition] = useState("");

  // Conditional Catholic-sacraments sub-section (the Narthex string-match rule).
  const isCatholic = baptized === "yes" && tradition.toLowerCase().includes("catholic");

  if (state.ok) {
    return (
      <div
        className="rounded-xl border border-navy/10 bg-cream/40 p-6 text-center shadow-sm"
        data-testid="apply-received"
      >
        <h1 className="text-xl text-navy">Application received</h1>
        <p className="mt-3 text-sm text-navy/70">
          Thank you for your interest in {parishName}. A member of our team will be in touch soon.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="rounded-xl border border-navy/10 bg-cream/40 p-6 text-center shadow-sm">
      <h1 className="text-xl text-navy">Inquire about OCIA</h1>
      <p className="mt-1 mb-5 text-sm text-navy/60">{parishName}</p>

      <input type="hidden" name="parishId" value={parishId} />
      {/* Honeypot — hidden from humans, tempting to bots. */}
      <input type="text" name="company" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

      <div className="space-y-4">
        <div>
          <label className={LABEL} htmlFor="fullName">
            Full name
          </label>
          <input id="fullName" name="fullName" required data-testid="apply-name" className={INPUT} />
        </div>
        <div>
          <label className={LABEL} htmlFor="email">
            Email
          </label>
          <input id="email" name="email" type="email" required data-testid="apply-email" className={INPUT} />
        </div>
        <div>
          <label className={LABEL} htmlFor="phone">
            Phone <span className="text-navy/40">(optional)</span>
          </label>
          <input id="phone" name="phone" className={INPUT} />
        </div>

        <div className="border-t border-navy/10 pt-4">
          <label className={LABEL} htmlFor="baptized">
            Have you been baptized?
          </label>
          <select
            id="baptized"
            name="baptized"
            value={baptized}
            onChange={(e) => setBaptized(e.target.value)}
            data-testid="apply-baptized"
            className={INPUT}
          >
            <option value="">Prefer not to say</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
            <option value="unsure">Unsure</option>
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="faithTradition">
            Faith tradition <span className="text-navy/40">(optional)</span>
          </label>
          <input
            id="faithTradition"
            name="faithTradition"
            value={tradition}
            onChange={(e) => setTradition(e.target.value)}
            placeholder="e.g. Catholic, Baptist, none"
            className={INPUT}
          />
        </div>

        {isCatholic ? (
          <fieldset className="rounded-md border border-gold/40 bg-gold/5 p-3 text-left" data-testid="apply-sacraments">
            <legend className="px-1 text-xs font-medium text-burgundy">Sacraments received</legend>
            {["First Communion", "Confirmation"].map((s) => (
              <label key={s} className="flex items-center gap-2 py-1 text-sm text-navy">
                <input type="checkbox" name="sacraments" value={s} className="accent-gold" />
                {s}
              </label>
            ))}
          </fieldset>
        ) : null}

        <div className="border-t border-navy/10 pt-4">
          <label className={LABEL} htmlFor="notes">
            Anything you&apos;d like us to know? <span className="text-navy/40">(optional)</span>
          </label>
          <textarea id="notes" name="notes" rows={3} className={INPUT} />
        </div>
      </div>

      {state.error ? (
        <p className="mt-4 rounded-md bg-rose/10 px-3 py-2 text-sm text-rose" data-testid="apply-error">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        data-testid="apply-submit"
        className="mt-6 w-full rounded-md bg-burgundy px-4 py-2.5 font-semibold text-cream transition hover:bg-rose disabled:opacity-50"
      >
        {pending ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}
