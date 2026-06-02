"use server";

import { isStaff } from "@parvaordo/shared";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  approveProject,
  deleteProjectSlide,
  deleteRecordings,
  getProject,
  markProjectReady,
  mintMcpToken,
  rejectProject,
  reopenProject,
  reorderProjectSlides,
  updateScriptDraft,
} from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";

async function ctx(): Promise<{ parishId: string; userId: string }> {
  const v = await getViewer();
  if (!v?.identity?.parishId || !v.identity.userId) redirect("/login");
  return { parishId: v.identity.parishId, userId: v.identity.userId };
}

/** Persist the teen's manual script edit. */
export async function saveScriptAction(projectId: string, text: string): Promise<void> {
  const { parishId } = await ctx();
  await updateScriptDraft(parishId, projectId, text);
  revalidatePath(`/parvus-studio/projects/${projectId}`);
}

/** Poll target: current status + script (Claude writes via MCP; page reflects it live). */
export async function getScriptAction(projectId: string): Promise<{ status: string; fullText: string }> {
  const { parishId } = await ctx();
  const p = await getProject(parishId, projectId);
  return { status: p?.status ?? "drafting", fullText: p?.scriptDraft?.full_text ?? "" };
}

/** Mint an MCP session token to paste into Claude Desktop. */
export async function startAiSessionAction(): Promise<{ token: string; expiresAt: string }> {
  const { parishId, userId } = await ctx();
  return mintMcpToken(parishId, userId);
}

/** Teen marks the project ready to record. */
export async function markReadyAction(projectId: string): Promise<void> {
  const { parishId } = await ctx();
  await markProjectReady(parishId, projectId);
  revalidatePath(`/parvus-studio/projects/${projectId}`);
}

/** Delete the project's recording (DB + Bunny) and reopen it for re-recording.
 * "Replace" = delete here, then record again from Parvus Studio. */
export async function deleteRecordingAction(projectId: string): Promise<void> {
  const { parishId } = await ctx();
  await deleteRecordings(parishId, projectId);
  await reopenProject(parishId, projectId);
  revalidatePath(`/parvus-studio/projects/${projectId}`);
}

/** Catechist/admin review of a submitted recording: approve or reject. */
export async function reviewProjectAction(projectId: string, decision: "approved" | "rejected"): Promise<void> {
  const v = await getViewer();
  const role = v?.identity?.role;
  if (!v?.identity?.parishId || !isStaff(role)) redirect("/");
  await (decision === "approved" ? approveProject : rejectProject)(v.identity.parishId, projectId);
  revalidatePath(`/parvus-studio/projects/${projectId}`);
}

/** Remove a slide by id. */
export async function deleteSlideAction(projectId: string, slideId: string): Promise<void> {
  const { parishId } = await ctx();
  await deleteProjectSlide(parishId, projectId, slideId);
  revalidatePath(`/parvus-studio/projects/${projectId}`);
}

/** Persist a new slide ordering (drag-and-drop). */
export async function reorderSlidesAction(projectId: string, orderedIds: string[]): Promise<void> {
  const { parishId } = await ctx();
  await reorderProjectSlides(parishId, projectId, orderedIds);
  revalidatePath(`/parvus-studio/projects/${projectId}`);
}
