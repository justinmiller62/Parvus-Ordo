"use server";

import { redirect } from "next/navigation";
import {
  isVideoItemWatched,
  markItemComplete,
  markVideoProgress,
  submitAnswer,
  submitStudentFeedback,
  submitStudentQuestion,
} from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";

// Resolve the learner against their ACTIVE parish (multi-parish aware).
async function studentContext(): Promise<{ parishId: string; userId: string } | null> {
  const v = await getViewer();
  if (!v?.identity?.parishId) return null;
  return { parishId: v.identity.parishId, userId: v.identity.userId };
}

/** Submit a question for the catechist from the lesson completion screen. */
export async function submitQuestionAction(lessonId: string, text: string): Promise<{ ok: boolean }> {
  const ctx = await studentContext();
  const t = text.trim();
  if (!ctx || !t) return { ok: false };
  await submitStudentQuestion({ parishId: ctx.parishId, studentId: ctx.userId, lessonId, text: t });
  return { ok: true };
}

/** Submit lesson feedback for the catechist from the completion screen. */
export async function submitFeedbackAction(lessonId: string, text: string): Promise<{ ok: boolean }> {
  const ctx = await studentContext();
  const t = text.trim();
  if (!ctx || !t) return { ok: false };
  await submitStudentFeedback({ parishId: ctx.parishId, studentId: ctx.userId, lessonId, text: t });
  return { ok: true };
}

/**
 * Persist video watch progress (furthest point reached). Best-effort. Completion is
 * derived server-side from this point (see markVideoProgress) — the client does not
 * get to assert that a video is "done".
 */
export async function saveVideoProgressAction(itemId: string, maxReachedMs: number): Promise<void> {
  const ctx = await studentContext();
  if (!ctx) return;
  await markVideoProgress({ parishId: ctx.parishId, studentId: ctx.userId, itemId, maxReachedMs });
}

/**
 * Complete the current wizard item and advance to the next step. For questions,
 * the answer is saved first (and is required — you can't advance unanswered).
 */
export async function advanceAction(formData: FormData): Promise<void> {
  const ctx = await studentContext();
  if (!ctx) redirect("/login");

  const lessonId = String(formData.get("lessonId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const step = Number(formData.get("step") ?? 0);

  if (kind === "question") {
    const text = String(formData.get("text") ?? "").trim();
    if (!text) {
      // No answer — bounce back to the same step without completing.
      redirect(`/ocia/lessons/${lessonId}?step=${step}`);
    }
    await submitAnswer({
      parishId: ctx.parishId,
      studentId: ctx.userId,
      itemId,
      text,
    });
  } else if (kind === "video") {
    // The client `watched` state that unlocks Continue is cosmetic — enforce the
    // watch server-side so a direct POST here can't complete an unwatched video.
    // If the persisted progress isn't yet within tolerance of the clip end, bounce
    // back to the same step instead of completing. A legitimate learner who clicks
    // the instant the button unlocks (before the final progress save lands) simply
    // re-lands on the step, which resumes at the end and re-unlocks — self-healing.
    if (!(await isVideoItemWatched({ parishId: ctx.parishId, studentId: ctx.userId, itemId }))) {
      redirect(`/ocia/lessons/${lessonId}?step=${step}`);
    }
  }

  await markItemComplete({ parishId: ctx.parishId, studentId: ctx.userId, itemId });
  redirect(`/ocia/lessons/${lessonId}?step=${step + 1}`);
}
