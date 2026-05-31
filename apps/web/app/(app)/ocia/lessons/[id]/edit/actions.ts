"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addLessonItem,
  deleteLesson,
  deleteLessonItem,
  deleteVersion,
  ensureDraft,
  getDb,
  publishVersion,
  removeClip,
  removeClipForItem,
  removeClipsForLesson,
  reorderLessonItems,
  requestClip,
  unpublishLesson,
  updateLessonItem,
  updateVersionMeta,
  type LessonItemKind,
} from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";

async function requireBuilder(): Promise<{ parishId: string; userId: string }> {
  const v = await getViewer();
  const role = v?.identity?.role;
  const parishId = v?.identity?.parishId;
  const userId = v?.identity?.userId;
  if (!parishId || !userId || !(role === "catechist" || role === "admin" || role === "super_admin")) {
    redirect("/ocia");
  }
  return { parishId, userId };
}

// Edits may only touch a parish-owned DRAFT (unpublished) version.
async function assertDraft(parishId: string, versionId: string): Promise<void> {
  const { rows } = await getDb(parishId).query<{ published_at: string | null; scope: string; parish_id: string | null }>(
    "SELECT published_at, scope, parish_id FROM lesson_versions WHERE id = $1",
    [versionId],
  );
  const v = rows[0];
  if (!v || v.scope !== "parish" || v.parish_id !== parishId || v.published_at !== null) {
    redirect("/ocia/lessons");
  }
}

function defaultContent(kind: LessonItemKind, format?: string): Record<string, unknown> {
  if (kind === "reading") return { html: "" };
  if (kind === "question") {
    return format === "multiple_choice"
      ? { prompt: "", format: "multiple_choice", choices: [{ label: "", correct: true }, { label: "", correct: false }] }
      : { prompt: "", format: "open_ended" };
  }
  if (kind === "video") return { asset_id: null, start_ms: 0, end_ms: null };
  return {};
}

const rp = (lessonId: string) => revalidatePath(`/ocia/lessons/${lessonId}/edit`);

/** Start editing: ensure a draft exists (copying the live version), then open it. */
export async function ensureDraftAction(lessonId: string): Promise<void> {
  const { parishId } = await requireBuilder();
  const draftId = await ensureDraft(parishId, lessonId);
  redirect(`/ocia/lessons/${lessonId}/edit?v=${draftId}`);
}

export async function addItemAction(
  lessonId: string,
  versionId: string,
  kind: LessonItemKind,
  format?: string,
): Promise<{ id: string; content: Record<string, unknown> }> {
  const { parishId } = await requireBuilder();
  await assertDraft(parishId, versionId);
  const content = defaultContent(kind, format);
  const id = await addLessonItem({ parishId, versionId, kind, content });
  rp(lessonId);
  return { id, content };
}

export async function updateItemAction(
  lessonId: string,
  versionId: string,
  itemId: string,
  content: Record<string, unknown>,
): Promise<void> {
  const { parishId } = await requireBuilder();
  await assertDraft(parishId, versionId);
  await updateLessonItem({ parishId, itemId, content });
  rp(lessonId);
}

export async function deleteItemAction(lessonId: string, versionId: string, itemId: string): Promise<void> {
  const { parishId } = await requireBuilder();
  await assertDraft(parishId, versionId);
  await removeClipForItem(parishId, itemId); // clean up the item's cut clip, if any
  await deleteLessonItem({ parishId, itemId });
  rp(lessonId);
}

export async function reorderAction(lessonId: string, versionId: string, orderedIds: string[]): Promise<void> {
  const { parishId } = await requireBuilder();
  await assertDraft(parishId, versionId);
  await reorderLessonItems({ parishId, versionId, orderedIds });
  rp(lessonId);
}

export async function updateMetaAction(
  lessonId: string,
  versionId: string,
  title: string,
  description: string,
): Promise<void> {
  const { parishId } = await requireBuilder();
  await assertDraft(parishId, versionId);
  await updateVersionMeta({ parishId, versionId, title, description: description || null });
  rp(lessonId);
}

/** Publish a draft, or make an already-published version live again (rollback). */
export async function publishAction(lessonId: string, versionId: string): Promise<void> {
  const { parishId } = await requireBuilder();
  await publishVersion({ parishId, lessonId, versionId });
  rp(lessonId);
}

/** Take the lesson offline (no live version). */
export async function unpublishAction(lessonId: string): Promise<void> {
  const { parishId } = await requireBuilder();
  await unpublishLesson({ parishId, lessonId });
  rp(lessonId);
}

/**
 * Cut a physical clip for a video item's [start,end] window and point the item at
 * it. Re-cutting (changed window) replaces + deletes the prior clip. The clip
 * processes asynchronously (status flips to 'ready' via the ClipProcessor).
 */
export async function materializeClipAction(
  lessonId: string,
  versionId: string,
  itemId: string,
  sourceAssetId: string,
  startMs: number,
  endMs: number | null,
): Promise<{ clipAssetId: string }> {
  const { parishId, userId } = await requireBuilder();
  await assertDraft(parishId, versionId);
  const { rows } = await getDb(parishId).query<{ content: Record<string, unknown> }>(
    "SELECT content FROM lesson_items WHERE id = $1",
    [itemId],
  );
  const content = rows[0]?.content ?? {};
  const prevClip = content.clip_asset_id as string | undefined;

  const clipAssetId = await requestClip({ parishId, createdBy: userId, sourceAssetId, startMs, endMs });
  await updateLessonItem({
    parishId,
    itemId,
    content: { ...content, asset_id: sourceAssetId, start_ms: startMs, end_ms: endMs, clip_asset_id: clipAssetId },
  });
  if (prevClip && prevClip !== clipAssetId) await removeClip(parishId, prevClip);
  rp(lessonId);
  return { clipAssetId };
}

/** Discard a draft / delete a historical version (not the live one). */
export async function deleteVersionAction(lessonId: string, versionId: string): Promise<void> {
  const { parishId } = await requireBuilder();
  await deleteVersion({ parishId, lessonId, versionId });
  redirect(`/ocia/lessons/${lessonId}/edit`);
}

/** Delete the whole lesson (parish-owned only). */
export async function deleteLessonAction(lessonId: string): Promise<void> {
  const { parishId } = await requireBuilder();
  await removeClipsForLesson(parishId, lessonId); // clean up all cut clips first
  await deleteLesson(parishId, lessonId);
  redirect("/ocia/lessons");
}
