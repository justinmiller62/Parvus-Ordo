"use server";

import { isStaff } from "@parvaordo/shared";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createYouthProject, createYouthTopic, deleteYouthProject } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";

// Staff-only (catechist/admin/super_admin) parvus-studio management actions.
async function staffCtx(): Promise<{ parishId: string }> {
  const v = await getViewer();
  const role = v?.identity?.role;
  if (!v?.identity?.parishId || !isStaff(role)) redirect("/");
  return { parishId: v.identity.parishId };
}

/** Create a project and assign it to a teen. */
export async function createProjectAction(formData: FormData): Promise<void> {
  const { parishId } = await staffCtx();
  const teenUserId = String(formData.get("teenUserId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const topicId = String(formData.get("topicId") ?? "") || null;
  if (!teenUserId || !title) return;
  await createYouthProject(parishId, { teenUserId, title, topicId });
  revalidatePath("/parvus-studio");
}

/** Delete a project (recordings + audit cascade). */
export async function deleteProjectAction(formData: FormData): Promise<void> {
  const { parishId } = await staffCtx();
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return;
  await deleteYouthProject(parishId, projectId);
  revalidatePath("/parvus-studio");
}

/** Add a topic to the parish's topic library. */
export async function createTopicAction(formData: FormData): Promise<void> {
  const { parishId } = await staffCtx();
  const title = String(formData.get("title") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  if (!title || !category) return;
  await createYouthTopic(parishId, {
    category,
    title,
    commonMisconception: String(formData.get("commonMisconception") ?? "").trim() || undefined,
    correctTeaching: String(formData.get("correctTeaching") ?? "").trim() || undefined,
    ageBand: String(formData.get("ageBand") ?? "").trim() || undefined,
  });
  revalidatePath("/parvus-studio");
}
