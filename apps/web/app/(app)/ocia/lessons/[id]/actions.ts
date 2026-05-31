"use server";

import { redirect } from "next/navigation";
import {
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

/** Persist video watch progress (furthest point + completion). Best-effort. */
export async function saveVideoProgressAction(
  itemId: string,
  maxReachedMs: number,
  completed: boolean,
): Promise<void> {
  const ctx = await studentContext();
  if (!ctx) return;
  await markVideoProgress({ parishId: ctx.parishId, studentId: ctx.userId, itemId, maxReachedMs, completed });
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
  }

  await markItemComplete({ parishId: ctx.parishId, studentId: ctx.userId, itemId });
  redirect(`/ocia/lessons/${lessonId}?step=${step + 1}`);
}
