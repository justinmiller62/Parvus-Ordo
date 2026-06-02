"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { INVITABLE_ROLES, InviteError, inviteMember, lookupAppUser } from "@parvaordo/core";
import { IMPERSONATABLE_ROLES, isAdmin, type Role } from "@parvaordo/shared";
import { getAuthedUser, signOutAndRedirect } from "@/src/lib/auth";
import { ACTIVE_PARISH_COOKIE, VIEW_AS_COOKIE, getViewer } from "@/src/lib/viewer";

export async function signOutAction(): Promise<void> {
  const jar = await cookies();
  jar.delete(VIEW_AS_COOKIE); // drop impersonation
  jar.delete(ACTIVE_PARISH_COOKIE); // and the active-parish choice
  await signOutAndRedirect();
}

/** Set the active parish (chooser pick / switcher) — only one the user belongs to. */
export async function setActiveParishAction(parishId: string): Promise<void> {
  const v = await getViewer();
  if (!v?.identity?.memberships.some((m) => m.parishId === parishId)) return;
  (await cookies()).set(ACTIVE_PARISH_COOKIE, parishId, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/");
}

/** Super-admin only: view the app as another role (same parish). */
export async function impersonateAction(role: string): Promise<void> {
  const authed = await getAuthedUser();
  if (!authed) return;
  const real = await lookupAppUser(authed.email);
  if (!real?.isSuperAdmin) return; // gate: only real super-admins
  if (!IMPERSONATABLE_ROLES.includes(role as Role)) return;
  (await cookies()).set(VIEW_AS_COOKIE, role, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/");
}

export async function exitImpersonationAction(): Promise<void> {
  (await cookies()).delete(VIEW_AS_COOKIE);
  redirect("/");
}

export interface InviteState {
  ok: boolean;
  error?: string;
  message?: string;
}

/** Top-level parish invite-by-email (admin/super_admin). Grants any invitable
 * role — admin, catechist, catechumen/candidate, youth teen, or parish member. */
export async function inviteMemberAction(_prev: InviteState, form: FormData): Promise<InviteState> {
  const v = await getViewer();
  const role = v?.identity?.role ?? null;
  const parishId = v?.identity?.parishId;
  const userId = v?.identity?.userId;
  if (!parishId || !userId || !isAdmin(role)) {
    return { ok: false, error: "Not authorized." };
  }
  const email = ((form.get("email") as string) ?? "").trim();
  const fullName = ((form.get("fullName") as string) ?? "").trim() || undefined;
  const targetRole = form.get("role") as Role;
  if (!INVITABLE_ROLES.includes(targetRole)) return { ok: false, error: "Pick a valid role." };

  try {
    const result = await inviteMember({ email, fullName, role: targetRole }, { userId, role, parishId });
    revalidatePath("/");
    return {
      ok: true,
      message: result.invitationSent
        ? `Invitation sent to ${email}.`
        : `${email} added. (Set WORKOS_API_KEY to email the invite; they'll resolve on first login regardless.)`,
    };
  } catch (e) {
    if (e instanceof InviteError) return { ok: false, error: e.message };
    return { ok: false, error: "Could not send the invitation. Please try again." };
  }
}
