"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  INVITABLE_ROLES,
  InviteError,
  dismissApplicant,
  inviteApplicantAsStudent,
  inviteMember,
  setApplicationsEnabled,
  softDeleteApplicant,
} from "@parvaordo/core";
import { isStaff, type Role } from "@parvaordo/shared";
import { getViewer } from "@/src/lib/viewer";
import { requireModule } from "@/src/lib/require-role";

interface Reviewer {
  parishId: string;
  userId: string;
  role: Role;
}

/** Applicant review + inviting requires admin/catechist (or super_admin) in the active parish. */
async function requireReviewer(): Promise<Reviewer> {
  await requireModule("ocia"); // disabled OCIA → redirect home (RFC-001 §3.5)
  const v = await getViewer();
  const role = v?.identity?.role;
  const parishId = v?.identity?.parishId;
  const userId = v?.identity?.userId;
  if (!parishId || !userId || !isStaff(role)) {
    redirect("/ocia");
  }
  return { parishId, userId, role };
}

export interface InviteState {
  ok: boolean;
  error?: string;
  message?: string;
}

export async function inviteMemberAction(_prev: InviteState, form: FormData): Promise<InviteState> {
  const caller = await requireReviewer();
  const email = ((form.get("email") as string) ?? "").trim();
  const targetRole = form.get("role") as Role;
  if (!INVITABLE_ROLES.includes(targetRole)) return { ok: false, error: "Pick a valid role." };

  try {
    const result = await inviteMember(
      { email, role: targetRole },
      { userId: caller.userId, role: caller.role, parishId: caller.parishId },
    );
    revalidatePath("/ocia/applicants");
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

export async function convertApplicantAction(applicantId: string): Promise<void> {
  const caller = await requireReviewer();
  try {
    await inviteApplicantAsStudent(caller.parishId, applicantId, {
      userId: caller.userId,
      role: caller.role,
      parishId: caller.parishId,
    });
  } catch (e) {
    // Conflict = they already hold the role; treat the applicant as converted anyway.
    if (e instanceof InviteError && e.code === "conflict") {
      await dismissApplicant(caller.parishId, applicantId, caller.userId);
    } else {
      throw e;
    }
  }
  revalidatePath("/ocia/applicants");
}

export async function dismissApplicantAction(applicantId: string): Promise<void> {
  const caller = await requireReviewer();
  await dismissApplicant(caller.parishId, applicantId, caller.userId);
  revalidatePath("/ocia/applicants");
}

export async function deleteApplicantAction(applicantId: string): Promise<void> {
  const caller = await requireReviewer();
  await softDeleteApplicant(caller.parishId, applicantId);
  revalidatePath("/ocia/applicants");
}

export async function toggleApplicationsAction(enabled: boolean): Promise<void> {
  const caller = await requireReviewer();
  if (caller.role !== "admin" && caller.role !== "super_admin") redirect("/ocia/applicants");
  await setApplicationsEnabled(caller.parishId, enabled);
  revalidatePath("/ocia/applicants");
}
