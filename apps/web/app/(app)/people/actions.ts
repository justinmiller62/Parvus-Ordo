"use server";

import { revalidatePath } from "next/cache";
import { INVITABLE_ROLES, removeMember, revokeInvitation, setMemberName, setMemberRole } from "@parvaordo/core";
import type { Role } from "@parvaordo/shared";
import { requireAdmin } from "@/src/lib/require-role";

// People console is admin/super_admin only — guarded by the shared requireAdmin.
/** Rename a member (display name). */
export async function renameMemberAction(formData: FormData): Promise<void> {
  const { parishId } = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();
  if (!userId || !displayName) return;
  await setMemberName(parishId, userId, displayName);
  revalidatePath("/people");
}

/** Change a member's role. Can't change your own (avoid locking yourself out). */
export async function setRoleAction(formData: FormData): Promise<void> {
  const { parishId, userId: callerId } = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const role = formData.get("role") as Role;
  if (!userId || userId === callerId) return;
  if (!INVITABLE_ROLES.includes(role)) return;
  await setMemberRole(parishId, userId, role);
  revalidatePath("/people");
}

/** Remove a member from the parish. Can't remove yourself. */
export async function removeMemberAction(formData: FormData): Promise<void> {
  const { parishId, userId: callerId } = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!userId || userId === callerId) return;
  await removeMember(parishId, userId);
  revalidatePath("/people");
}

/** Revoke a pending invitation: kill the WorkOS invite + drop the local membership. */
export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const { parishId } = await requireAdmin();
  const invitationId = String(formData.get("invitationId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (invitationId) await revokeInvitation(invitationId);
  if (userId) await removeMember(parishId, userId);
  revalidatePath("/people");
}
