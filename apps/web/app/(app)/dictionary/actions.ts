"use server";

import { revalidatePath } from "next/cache";
import {
  createDictionarySubmission,
  deleteDictionarySubmission,
  updateDictionarySubmission,
  upsertOverride,
  type NewSubmissionInput,
  type OverrideInput,
} from "@parvaordo/core";
import { requireStaff } from "@/src/lib/require-role";

// Dictionary edits are catechist/admin/super_admin only.
/** Add a new term → parish submission (pending). */
export async function addEntryAction(input: NewSubmissionInput): Promise<void> {
  const { parishId, userId } = await requireStaff();
  await createDictionarySubmission(parishId, userId, input);
  revalidatePath("/dictionary");
}

/** Edit a parish submission in place. */
export async function editSubmissionAction(id: string, input: NewSubmissionInput): Promise<void> {
  const { parishId } = await requireStaff();
  await updateDictionarySubmission(parishId, id, input);
  revalidatePath("/dictionary");
}

/** Edit a universal entry → upsert a parish override (only changed fields). */
export async function overrideEntryAction(entryId: string, o: OverrideInput): Promise<void> {
  const { parishId } = await requireStaff();
  await upsertOverride(parishId, entryId, o);
  revalidatePath("/dictionary");
}

/** Delete a parish submission. */
export async function deleteSubmissionAction(id: string): Promise<void> {
  const { parishId } = await requireStaff();
  await deleteDictionarySubmission(parishId, id);
  revalidatePath("/dictionary");
}
