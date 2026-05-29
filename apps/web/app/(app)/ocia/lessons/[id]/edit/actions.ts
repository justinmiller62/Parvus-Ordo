"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addLessonItem,
  deleteLessonItem,
  reorderLessonItems,
  setLessonPublished,
  updateLesson,
  updateLessonItem,
  type LessonItemKind,
} from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";

// Authoring is restricted to catechist/admin/super_admin (RLS only scopes by
// parish, so the role gate lives here in the app layer).
async function requireBuilder(): Promise<{ parishId: string }> {
  const v = await getViewer();
  const role = v?.identity?.role;
  const parishId = v?.identity?.parishId;
  if (!parishId || !(role === "catechist" || role === "admin" || role === "super_admin")) {
    redirect("/ocia");
  }
  return { parishId };
}

function defaultContent(kind: LessonItemKind, format?: string): Record<string, unknown> {
  if (kind === "reading") return { html: "" };
  if (kind === "question") {
    return format === "multiple_choice"
      ? { prompt: "", format: "multiple_choice", choices: [{ label: "", correct: true }] }
      : { prompt: "", format: "open_ended" };
  }
  return {};
}

export async function addItemAction(
  lessonId: string,
  kind: LessonItemKind,
  format?: string,
): Promise<{ id: string; content: Record<string, unknown> }> {
  const { parishId } = await requireBuilder();
  const content = defaultContent(kind, format);
  const id = await addLessonItem({ parishId, lessonId, kind, content });
  revalidatePath(`/ocia/lessons/${lessonId}/edit`);
  return { id, content };
}

export async function updateItemAction(
  lessonId: string,
  itemId: string,
  content: Record<string, unknown>,
): Promise<void> {
  const { parishId } = await requireBuilder();
  await updateLessonItem({ parishId, itemId, content });
  revalidatePath(`/ocia/lessons/${lessonId}/edit`);
}

export async function deleteItemAction(lessonId: string, itemId: string): Promise<void> {
  const { parishId } = await requireBuilder();
  await deleteLessonItem({ parishId, itemId });
  revalidatePath(`/ocia/lessons/${lessonId}/edit`);
}

export async function reorderAction(lessonId: string, orderedIds: string[]): Promise<void> {
  const { parishId } = await requireBuilder();
  await reorderLessonItems({ parishId, lessonId, orderedIds });
  revalidatePath(`/ocia/lessons/${lessonId}/edit`);
}

export async function publishAction(lessonId: string, published: boolean): Promise<void> {
  const { parishId } = await requireBuilder();
  await setLessonPublished({ parishId, lessonId, published });
  revalidatePath(`/ocia/lessons/${lessonId}/edit`);
}

export async function updateLessonAction(
  lessonId: string,
  title: string,
  description: string,
): Promise<void> {
  const { parishId } = await requireBuilder();
  await updateLesson({ parishId, lessonId, title: title.trim() || "Untitled lesson", description: description || null });
  revalidatePath(`/ocia/lessons/${lessonId}/edit`);
}
