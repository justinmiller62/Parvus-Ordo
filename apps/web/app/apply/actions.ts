"use server";

import { headers } from "next/headers";
import { createOciaApplicant, resolveParishIdForHost } from "@parvaordo/core";

export interface ApplyState {
  ok: boolean;
  error?: string;
}

/**
 * Public OCIA application submit. Parish is resolved authoritatively from the
 * request hostname (subdomain → slug); on the apex it falls back to the parish
 * the visitor picked. `core.createOciaApplicant` enforces the per-parish
 * applications toggle + a resubmit throttle, so a closed/forged parish is rejected.
 */
export async function submitApplicationAction(_prev: ApplyState, form: FormData): Promise<ApplyState> {
  // Honeypot: real users never fill the hidden "company" field; bots do. Pretend success.
  if (((form.get("company") as string) ?? "").trim()) return { ok: true };

  const host = (await headers()).get("host");
  const parishId = (await resolveParishIdForHost(host)) ?? ((form.get("parishId") as string) || null);
  if (!parishId) {
    return { ok: false, error: "We couldn't determine your parish. Please use your parish's website to apply." };
  }

  const email = ((form.get("email") as string) ?? "").trim();
  const fullName = ((form.get("fullName") as string) ?? "").trim();

  const sacraments = form.getAll("sacraments").map(String);
  const formData: Record<string, unknown> = {
    phone: ((form.get("phone") as string) || "").trim() || undefined,
    baptized: (form.get("baptized") as string) || undefined,
    faithTradition: ((form.get("faithTradition") as string) || "").trim() || undefined,
    sacraments: sacraments.length ? sacraments : undefined,
    notes: ((form.get("notes") as string) || "").trim() || undefined,
  };

  try {
    await createOciaApplicant({ parishId, email, fullName, formData });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong. Please try again." };
  }
}
