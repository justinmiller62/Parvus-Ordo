"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  addScheduleEntry,
  type CohortSettingsInput,
  createPath,
  deleteCohort,
  deletePath,
  generateSchedule,
  removeScheduleEntry,
  type ScheduleEntryPatch,
  setPathLessons,
  setSequential,
  toggleMember,
  togglePathMember,
  updateCohortSettings,
  updateScheduleEntry,
} from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";

// Managing an existing cohort (schedule, roster, paths, settings) is catechist + admin.
async function staffCtx(): Promise<{ parishId: string }> {
  const v = await getViewer();
  const role = v?.identity?.role;
  const isStaff = role === "admin" || role === "catechist" || role === "super_admin";
  if (!v?.identity?.parishId || !isStaff) redirect("/");
  return { parishId: v.identity.parishId };
}

// Deleting a cohort is admin-only.
async function adminCtx(): Promise<{ parishId: string }> {
  const v = await getViewer();
  const role = v?.identity?.role;
  if (!v?.identity?.parishId || !(role === "admin" || role === "super_admin")) redirect("/");
  return { parishId: v.identity.parishId };
}

const rev = (cohortId: string) => revalidatePath(`/ocia/cohorts/${cohortId}`);

export async function updateSettingsAction(cohortId: string, input: CohortSettingsInput): Promise<void> {
  const { parishId } = await staffCtx();
  await updateCohortSettings(parishId, cohortId, input);
  rev(cohortId);
}

export async function setSequentialAction(cohortId: string, sequential: boolean): Promise<void> {
  const { parishId } = await staffCtx();
  await setSequential(parishId, cohortId, sequential);
  rev(cohortId);
}

export async function generateScheduleAction(cohortId: string): Promise<void> {
  const { parishId } = await staffCtx();
  await generateSchedule(parishId, cohortId);
  rev(cohortId);
}

export async function addScheduleEntryAction(cohortId: string, lessonId: string): Promise<void> {
  const { parishId } = await staffCtx();
  if (!lessonId) return;
  await addScheduleEntry(parishId, cohortId, lessonId);
  rev(cohortId);
}

export async function updateScheduleEntryAction(
  cohortId: string,
  entryId: string,
  patch: ScheduleEntryPatch,
): Promise<void> {
  const { parishId } = await staffCtx();
  await updateScheduleEntry(parishId, entryId, patch);
  rev(cohortId);
}

export async function removeScheduleEntryAction(cohortId: string, entryId: string): Promise<void> {
  const { parishId } = await staffCtx();
  await removeScheduleEntry(parishId, entryId);
  rev(cohortId);
}

export async function toggleMemberAction(cohortId: string, studentId: string, member: boolean): Promise<void> {
  const { parishId } = await staffCtx();
  await toggleMember(parishId, cohortId, studentId, member);
  rev(cohortId);
}

export async function createPathAction(cohortId: string, name: string): Promise<void> {
  const { parishId } = await staffCtx();
  await createPath(parishId, cohortId, name);
  rev(cohortId);
}

export async function deletePathAction(cohortId: string, pathId: string): Promise<void> {
  const { parishId } = await staffCtx();
  await deletePath(parishId, pathId);
  rev(cohortId);
}

export async function setPathLessonsAction(cohortId: string, pathId: string, lessonIds: string[]): Promise<void> {
  const { parishId } = await staffCtx();
  await setPathLessons(parishId, pathId, lessonIds);
  rev(cohortId);
}

export async function togglePathMemberAction(
  cohortId: string,
  pathId: string,
  studentId: string,
  member: boolean,
): Promise<void> {
  const { parishId } = await staffCtx();
  await togglePathMember(parishId, pathId, studentId, member);
  rev(cohortId);
}

export async function deleteCohortAction(cohortId: string): Promise<void> {
  const { parishId } = await adminCtx();
  await deleteCohort(parishId, cohortId);
  redirect("/ocia/cohorts");
}
