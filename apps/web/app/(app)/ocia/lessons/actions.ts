"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createLesson, deleteLesson, forkLesson, removeClipsForLesson, unpublishLesson } from "@parvaordo/core";
import { requireStaff } from "@/src/lib/require-role";

export async function createLessonAction(): Promise<void> {
  const { parishId, userId } = await requireStaff("/ocia");
  const id = await createLesson({ parishId, createdBy: userId });
  redirect(`/ocia/lessons/${id}/edit`);
}

export async function forkLessonAction(sourceLessonId: string): Promise<void> {
  const { parishId, userId } = await requireStaff("/ocia");
  const id = await forkLesson({ parishId, createdBy: userId, sourceLessonId });
  redirect(`/ocia/lessons/${id}/edit`);
}

/** Delete a parish lesson straight from the manage list (clips cleaned up first). */
export async function deleteLessonFromListAction(lessonId: string): Promise<void> {
  const { parishId } = await requireStaff("/ocia");
  await removeClipsForLesson(parishId, lessonId);
  await deleteLesson(parishId, lessonId);
  revalidatePath("/ocia/lessons");
}

/** Take a parish lesson offline from the manage list. */
export async function unpublishLessonFromListAction(lessonId: string): Promise<void> {
  const { parishId } = await requireStaff("/ocia");
  await unpublishLesson({ parishId, lessonId });
  revalidatePath("/ocia/lessons");
}
