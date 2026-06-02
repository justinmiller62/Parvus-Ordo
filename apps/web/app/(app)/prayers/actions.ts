"use server";

import { revalidatePath } from "next/cache";
import {
  createPrayerSubmission,
  deletePrayerSubmission,
  updatePrayerSubmission,
  upsertPrayerOverride,
  type NewPrayerInput,
} from "@parvaordo/core";
import { requireStaff } from "@/src/lib/require-role";

export async function addPrayerAction(input: NewPrayerInput): Promise<void> {
  const { parishId, userId } = await requireStaff();
  await createPrayerSubmission(parishId, userId, input);
  revalidatePath("/prayers");
}

export async function editPrayerSubmissionAction(id: string, input: NewPrayerInput): Promise<void> {
  const { parishId } = await requireStaff();
  await updatePrayerSubmission(parishId, id, input);
  revalidatePath("/prayers");
}

export async function overridePrayerAction(
  entryId: string,
  o: { text?: string | null; context?: string | null; notes?: string | null },
): Promise<void> {
  const { parishId } = await requireStaff();
  await upsertPrayerOverride(parishId, entryId, o);
  revalidatePath("/prayers");
}

export async function deletePrayerAction(id: string): Promise<void> {
  const { parishId } = await requireStaff();
  await deletePrayerSubmission(parishId, id);
  revalidatePath("/prayers");
}
