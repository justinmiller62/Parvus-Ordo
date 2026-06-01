"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  createSubmission,
  deleteSubmission,
  updateSubmission,
  upsertOverride,
  type NewSubmissionInput,
  type OverrideInput,
} from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";

// Dictionary edits are catechist/admin/super_admin only.
async function staffCtx(): Promise<{ parishId: string; userId: string }> {
  const v = await getViewer();
  const role = v?.identity?.role;
  const isStaff = role === "catechist" || role === "admin" || role === "super_admin";
  if (!v?.identity?.parishId || !v.identity.userId || !isStaff) redirect("/");
  return { parishId: v.identity.parishId, userId: v.identity.userId };
}

/** Add a new term → parish submission (pending). */
export async function addEntryAction(input: NewSubmissionInput): Promise<void> {
  const { parishId, userId } = await staffCtx();
  await createSubmission(parishId, userId, input);
  revalidatePath("/dictionary");
}

/** Edit a parish submission in place. */
export async function editSubmissionAction(id: string, input: NewSubmissionInput): Promise<void> {
  const { parishId } = await staffCtx();
  await updateSubmission(parishId, id, input);
  revalidatePath("/dictionary");
}

/** Edit a universal entry → upsert a parish override (only changed fields). */
export async function overrideEntryAction(entryId: string, o: OverrideInput): Promise<void> {
  const { parishId } = await staffCtx();
  await upsertOverride(parishId, entryId, o);
  revalidatePath("/dictionary");
}

/** Delete a parish submission. */
export async function deleteSubmissionAction(id: string): Promise<void> {
  const { parishId } = await staffCtx();
  await deleteSubmission(parishId, id);
  revalidatePath("/dictionary");
}
