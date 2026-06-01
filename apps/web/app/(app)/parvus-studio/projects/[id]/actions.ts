"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { deleteProjectSlide, getProject, mintMcpToken, setProjectStatus, updateScriptDraft } from "@parvaordo/core";
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

/** Flip the project to ready_to_record. */
export async function markReadyAction(projectId: string): Promise<void> {
  const { parishId } = await ctx();
  await setProjectStatus(parishId, projectId, "ready_to_record");
  revalidatePath(`/parvus-studio/projects/${projectId}`);
}

/** Remove a slide at `slide_order`. */
export async function deleteSlideAction(projectId: string, order: number): Promise<void> {
  const { parishId } = await ctx();
  await deleteProjectSlide(parishId, projectId, order);
  revalidatePath(`/parvus-studio/projects/${projectId}`);
}
