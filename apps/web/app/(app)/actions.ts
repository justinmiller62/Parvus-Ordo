"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { lookupAppUser } from "@parvaordo/core";
import { IMPERSONATABLE_ROLES, type Role } from "@parvaordo/shared";
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
