"use server";

import { revalidatePath } from "next/cache";
import {
  AdminError,
  isValidCustomDomain,
  listParishes,
  provisionParish,
  setCustomDomains,
  setParishSubdomain,
} from "@parvaordo/core";
import { isValidSlug } from "@parvaordo/shared";
import { requireSuperAdmin } from "@/src/lib/require-role";

// Thin Server Action shims for the super-admin admin plane (RFC-004 §6/§12). Each one:
// requireSuperAdmin (re-asserts is_super_admin — nav hiding is not enforcement) -> marshal +
// shallow-validate the form -> call packages/core (platform/admin, which does the real
// validation + the audited cross-tenant DEFINER write) -> revalidatePath. NO business logic here.
// AdminError codes from core are mapped to specific, never-swallowed messages for the client.

/** Turn a core AdminError into a specific client message; rethrow a real (non-admin) failure. */
function messageFor(err: unknown, taken: string): string {
  if (err instanceof AdminError) {
    switch (err.code) {
      case "conflict":
        return taken;
      case "invalid":
        return err.message;
      case "not_found":
        return "That parish no longer exists.";
      case "forbidden":
        return "You are not authorized.";
    }
  }
  return "Something went wrong. Please try again.";
}

export interface CreateParishState {
  ok: boolean;
  error?: string;
  parish?: { id: string; name: string; slug: string };
}

export async function createParishAction(_prev: CreateParishState, form: FormData): Promise<CreateParishState> {
  const { userId } = await requireSuperAdmin();
  const name = String(form.get("name") ?? "").trim();
  const slug = String(form.get("slug") ?? "")
    .trim()
    .toLowerCase();
  const dioceseId = String(form.get("dioceseId") ?? "").trim();
  if (!name) return { ok: false, error: "Enter a parish name." };
  if (!slug) return { ok: false, error: "Enter a subdomain slug." };
  if (!dioceseId) return { ok: false, error: "Choose a diocese." };
  try {
    const id = await provisionParish(userId, { name, slug, dioceseId });
    revalidatePath("/admin");
    return { ok: true, parish: { id, name, slug } };
  } catch (err) {
    return { ok: false, error: messageFor(err, `The subdomain “${slug}” is already taken.`) };
  }
}

export interface EditState {
  ok: boolean;
  error?: string;
  message?: string;
}

export async function setSubdomainAction(_prev: EditState, form: FormData): Promise<EditState> {
  const { userId } = await requireSuperAdmin();
  const parishId = String(form.get("parishId") ?? "");
  const slug = String(form.get("slug") ?? "")
    .trim()
    .toLowerCase();
  if (!parishId) return { ok: false, error: "Missing parish." };
  if (!slug) return { ok: false, error: "Enter a subdomain slug." };
  try {
    await setParishSubdomain(userId, parishId, slug);
    revalidatePath(`/admin/${parishId}`);
    revalidatePath("/admin");
    return { ok: true, message: "Subdomain updated." };
  } catch (err) {
    return { ok: false, error: messageFor(err, `The subdomain “${slug}” is already taken.`) };
  }
}

export async function setCustomDomainsAction(_prev: EditState, form: FormData): Promise<EditState> {
  const { userId } = await requireSuperAdmin();
  const parishId = String(form.get("parishId") ?? "");
  if (!parishId) return { ok: false, error: "Missing parish." };
  // One domain per line or comma-separated; trimmed + non-empty.
  const domains = String(form.get("domains") ?? "")
    .split(/[\n,]/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  const bad = domains.find((d) => !isValidCustomDomain(d));
  if (bad) return { ok: false, error: `“${bad}” is not a valid hostname (e.g. parish.example.com).` };
  try {
    await setCustomDomains(userId, parishId, domains);
    revalidatePath(`/admin/${parishId}`);
    revalidatePath("/admin");
    return { ok: true, message: domains.length ? "Custom domains saved." : "Custom domains cleared." };
  } catch (err) {
    return { ok: false, error: messageFor(err, "One of those domains is already claimed by another parish.") };
  }
}

export interface SlugCheck {
  available: boolean;
  reason?: string;
}

/**
 * Live (debounced, client-driven) availability probe for the create form. Re-asserts super-admin,
 * checks the shape via the SHARED isValidSlug, then the global uniqueness via listParishes. Returns
 * a SPECIFIC reason — never a swallowed empty/zero result (RFC-004 §12). Advisory only: the create
 * action is the authoritative gate (provisionParish rejects a dup atomically).
 */
export async function checkSlugAction(slug: string): Promise<SlugCheck> {
  const { userId } = await requireSuperAdmin();
  const s = slug.trim().toLowerCase();
  if (!s) return { available: false };
  if (!isValidSlug(s)) {
    return { available: false, reason: "Use 3–63 lowercase letters, numbers, or hyphens (not “www”/“app”)." };
  }
  const taken = (await listParishes(userId)).some((p) => p.slug === s);
  return taken ? { available: false, reason: `“${s}” is already taken.` } : { available: true };
}
