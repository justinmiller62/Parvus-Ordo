"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createLesson, deleteLesson, forkLesson, removeClipsForLesson, unpublishLesson } from "@parvaordo/core";
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

/** Delete a parish lesson straight from the manage list (clips cleaned up first). */
export async function deleteLessonFromListAction(lessonId: string): Promise<void> {
  const { parishId } = await requireBuilder();
  await removeClipsForLesson(parishId, lessonId);
  await deleteLesson(parishId, lessonId);
  revalidatePath("/ocia/lessons");
}

/** Take a parish lesson offline from the manage list. */
export async function unpublishLessonFromListAction(lessonId: string): Promise<void> {
  const { parishId } = await requireBuilder();
  await unpublishLesson({ parishId, lessonId });
  revalidatePath("/ocia/lessons");
}
