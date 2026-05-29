"use server";

import { redirect } from "next/navigation";
import { createLesson, forkLesson } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";

async function requireBuilder(): Promise<{ parishId: string; userId: string }> {
  const v = await getViewer();
  const role = v?.identity?.role;
  const parishId = v?.identity?.parishId;
  if (!parishId || !(role === "catechist" || role === "admin" || role === "super_admin")) {
    redirect("/ocia");
  }
  return { parishId, userId: v!.identity!.userId };
}

export async function createLessonAction(): Promise<void> {
  const { parishId, userId } = await requireBuilder();
  const id = await createLesson({ parishId, createdBy: userId });
  redirect(`/ocia/lessons/${id}/edit`);
}

export async function forkLessonAction(sourceLessonId: string): Promise<void> {
  const { parishId, userId } = await requireBuilder();
  const id = await forkLesson({ parishId, createdBy: userId, sourceLessonId });
  redirect(`/ocia/lessons/${id}/edit`);
}
