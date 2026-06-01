"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { INVITABLE_ROLES, removeMember, revokeInvitation, setMemberRole } from "@parvaordo/core";
import type { Role } from "@parvaordo/shared";
import { getViewer } from "@/src/lib/viewer";

// People console is admin/super_admin only.
async function adminCtx(): Promise<{ parishId: string; userId: string }> {
  const v = await getViewer();
  const role = v?.identity?.role;
  if (!v?.identity?.parishId || !v.identity.userId || !(role === "admin" || role === "super_admin")) redirect("/");
  return { parishId: v.identity.parishId, userId: v.identity.userId };
}

/** Change a member's role. Can't change your own (avoid locking yourself out). */
export async function setRoleAction(formData: FormData): Promise<void> {
  const { parishId, userId: callerId } = await adminCtx();
  const userId = String(formData.get("userId") ?? "");
  const role = formData.get("role") as Role;
  if (!userId || userId === callerId) return;
  if (!INVITABLE_ROLES.includes(role)) return;
  await setMemberRole(parishId, userId, role);
  revalidatePath("/people");
}

/** Remove a member from the parish. Can't remove yourself. */
export async function removeMemberAction(formData: FormData): Promise<void> {
  const { parishId, userId: callerId } = await adminCtx();
  const userId = String(formData.get("userId") ?? "");
  if (!userId || userId === callerId) return;
  await removeMember(parishId, userId);
  revalidatePath("/people");
}

/** Revoke a pending invitation: kill the WorkOS invite + drop the local membership. */
export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const { parishId } = await adminCtx();
  const invitationId = String(formData.get("invitationId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (invitationId) await revokeInvitation(invitationId);
  if (userId) await removeMember(parishId, userId);
  revalidatePath("/people");
}
