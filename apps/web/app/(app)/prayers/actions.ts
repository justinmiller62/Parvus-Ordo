"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  createPrayerSubmission,
  deletePrayerSubmission,
  updatePrayerSubmission,
  upsertPrayerOverride,
  type NewPrayerInput,
} from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";

async function staffCtx(): Promise<{ parishId: string; userId: string }> {
  const v = await getViewer();
  const role = v?.identity?.role;
  const isStaff = role === "catechist" || role === "admin" || role === "super_admin";
  if (!v?.identity?.parishId || !v.identity.userId || !isStaff) redirect("/");
  return { parishId: v.identity.parishId, userId: v.identity.userId };
}

export async function addPrayerAction(input: NewPrayerInput): Promise<void> {
  const { parishId, userId } = await staffCtx();
  await createPrayerSubmission(parishId, userId, input);
  revalidatePath("/prayers");
}

export async function editPrayerSubmissionAction(id: string, input: NewPrayerInput): Promise<void> {
  const { parishId } = await staffCtx();
  await updatePrayerSubmission(parishId, id, input);
  revalidatePath("/prayers");
}

export async function overridePrayerAction(entryId: string, o: { text?: string | null; context?: string | null; notes?: string | null }): Promise<void> {
  const { parishId } = await staffCtx();
  await upsertPrayerOverride(parishId, entryId, o);
  revalidatePath("/prayers");
}

export async function deletePrayerAction(id: string): Promise<void> {
  const { parishId } = await staffCtx();
  await deletePrayerSubmission(parishId, id);
  revalidatePath("/prayers");
}
