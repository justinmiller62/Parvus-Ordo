"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import {
  markItemComplete,
  markVideoProgress,
  recordEngagementEvent,
  resolveStudentLessonCohort,
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

type StepKind = "reading" | "video" | "question";
const asStepKind = (k: string): StepKind | null => (k === "reading" || k === "video" || k === "question" ? k : null);

/**
 * Mark that a learner began a lesson (idempotent — one per student+version). Fired
 * once from the wizard's first step by a client beacon; best-effort telemetry that
 * never blocks the player. Suppressed in preview/review by only mounting the beacon
 * for an active learner (see the lesson page).
 */
export async function recordLessonStartAction(lessonId: string, versionId: string): Promise<void> {
  const ctx = await studentContext();
  if (!ctx || !versionId) return;
  try {
    const cohortId = await resolveStudentLessonCohort(ctx.parishId, ctx.userId, lessonId);
    await recordEngagementEvent({
      parishId: ctx.parishId,
      studentId: ctx.userId,
      lessonId,
      versionId,
      cohortId,
      type: "lesson_start",
    });
  } catch (err) {
    console.warn("engagement lesson_start failed", err);
  }
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
export async function saveVideoProgressAction(itemId: string, maxReachedMs: number, completed: boolean): Promise<void> {
  const ctx = await studentContext();
  if (!ctx) return;
  // Shape-validate the client-supplied values here; core enforces them against the
  // clip's real length so a forged position can't self-award completion (see
  // markVideoProgress). A non-finite report is treated as zero progress.
  const safeMax = Number.isFinite(maxReachedMs) ? Math.max(0, Math.floor(maxReachedMs)) : 0;
  await markVideoProgress({
    parishId: ctx.parishId,
    studentId: ctx.userId,
    itemId,
    maxReachedMs: safeMax,
    completed: completed === true,
  });
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
  const versionId = String(formData.get("versionId") ?? "");
  const total = Number(formData.get("total") ?? 0);

  let answerText = "";
  if (kind === "question") {
    answerText = String(formData.get("text") ?? "").trim();
    if (!answerText) {
      // No answer — bounce back to the same step without completing.
      redirect(`/ocia/lessons/${lessonId}?step=${step}`);
    }
    await submitAnswer({ parishId: ctx.parishId, studentId: ctx.userId, itemId, text: answerText });
  }

  await markItemComplete({ parishId: ctx.parishId, studentId: ctx.userId, itemId });

  // Engagement telemetry — best-effort, AFTER the response so it never delays the wizard.
  // The form/VideoStep is rendered only for an active learner, so preview/review never reach here.
  const stepKind = asStepKind(kind);
  if (versionId && stepKind) {
    after(async () => {
      try {
        const cohortId = await resolveStudentLessonCohort(ctx.parishId, ctx.userId, lessonId);
        const base = { parishId: ctx.parishId, studentId: ctx.userId, lessonId, versionId, cohortId };
        await recordEngagementEvent({ ...base, type: "step_complete", itemId, stepIndex: step, stepKind });
        if (kind === "question") {
          await recordEngagementEvent({
            ...base,
            type: "answer_submit",
            itemId,
            stepIndex: step,
            stepKind: "question",
            answerText,
          });
        }
        if (total > 0 && step + 1 >= total) {
          await recordEngagementEvent({ ...base, type: "lesson_complete" });
        }
      } catch (err) {
        console.warn("engagement advance failed", err);
      }
    });
  }

  redirect(`/ocia/lessons/${lessonId}?step=${step + 1}`);
}
