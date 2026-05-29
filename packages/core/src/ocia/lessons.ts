import { getDb, withTenant } from "../db/client";

export type ContentScope = "global" | "diocese" | "parish";
export type LessonItemKind = "reading" | "video" | "question";

export interface LessonRow {
  id: string;
  title: string;
  scope: ContentScope;
  lessonOrder: number;
  publishedAt: string | null;
}

export interface LessonItem {
  id: string;
  position: number;
  kind: LessonItemKind;
  content: Record<string, unknown>;
}

export interface LessonDetail {
  id: string;
  title: string;
  description: string | null;
  scope: ContentScope;
  items: LessonItem[];
}

/**
 * Lessons visible to a parish: the three-tier cascade (global ∪ its diocese ∪
 * its own parish) is enforced by RLS; this just reads what the parish may see.
 */
export async function getLessons(parishId: string): Promise<LessonRow[]> {
  const { rows } = await getDb(parishId).query<{
    id: string;
    title: string;
    scope: ContentScope;
    lesson_order: number;
    published_at: string | null;
  }>("SELECT id, title, scope, lesson_order, published_at FROM lessons ORDER BY scope, lesson_order, title");

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    scope: r.scope,
    lessonOrder: r.lesson_order,
    publishedAt: r.published_at,
  }));
}

/**
 * A single lesson with its ordered items, if visible to the parish (RLS returns
 * the lesson only when global / in the parish's diocese / owned by the parish).
 */
export async function getLessonDetail(parishId: string, lessonId: string): Promise<LessonDetail | null> {
  const db = getDb(parishId);

  const { rows: lessonRows } = await db.query<{
    id: string;
    title: string;
    description: string | null;
    scope: ContentScope;
  }>("SELECT id, title, description, scope FROM lessons WHERE id = $1", [lessonId]);

  const lesson = lessonRows[0];
  if (!lesson) return null;

  const { rows: items } = await db.query<{
    id: string;
    position: number;
    kind: LessonItemKind;
    content: Record<string, unknown>;
  }>("SELECT id, position, kind, content FROM lesson_items WHERE lesson_id = $1 ORDER BY position", [lessonId]);

  return {
    id: lesson.id,
    title: lesson.title,
    description: lesson.description,
    scope: lesson.scope,
    items: items.map((i) => ({ id: i.id, position: i.position, kind: i.kind, content: i.content })),
  };
}

// ── Builder (mutations). Tenant isolation is RLS; the catechist/admin role check
// is enforced in the Server Actions (app layer), since RLS only scopes by parish. ──

export interface LessonForEdit {
  id: string;
  title: string;
  description: string | null;
  scope: ContentScope;
  /** True only when this parish owns the lesson (scope=parish) and may edit it. */
  editable: boolean;
  published: boolean;
  items: LessonItem[];
}

export async function createLesson(params: {
  parishId: string;
  createdBy: string;
  title?: string;
}): Promise<string> {
  const { rows } = await getDb(params.parishId).query<{ id: string }>(
    `INSERT INTO lessons (scope, parish_id, title, created_by)
     VALUES ('parish', $1, $2, $3) RETURNING id`,
    [params.parishId, params.title?.trim() || "Untitled lesson", params.createdBy],
  );
  return rows[0]!.id;
}

export async function getLessonForEdit(parishId: string, lessonId: string): Promise<LessonForEdit | null> {
  const db = getDb(parishId);
  const { rows } = await db.query<{
    id: string;
    title: string;
    description: string | null;
    scope: ContentScope;
    parish_id: string | null;
    published_at: string | null;
  }>("SELECT id, title, description, scope, parish_id, published_at FROM lessons WHERE id = $1", [lessonId]);

  const l = rows[0];
  if (!l) return null;

  const { rows: items } = await db.query<{
    id: string;
    position: number;
    kind: LessonItemKind;
    content: Record<string, unknown>;
  }>("SELECT id, position, kind, content FROM lesson_items WHERE lesson_id = $1 ORDER BY position", [lessonId]);

  return {
    id: l.id,
    title: l.title,
    description: l.description,
    scope: l.scope,
    editable: l.scope === "parish" && l.parish_id === parishId,
    published: l.published_at !== null,
    items: items.map((i) => ({ id: i.id, position: i.position, kind: i.kind, content: i.content })),
  };
}

export async function updateLesson(params: {
  parishId: string;
  lessonId: string;
  title: string;
  description: string | null;
}): Promise<void> {
  await getDb(params.parishId).query("UPDATE lessons SET title = $1, description = $2 WHERE id = $3", [
    params.title,
    params.description,
    params.lessonId,
  ]);
}

export async function setLessonPublished(params: {
  parishId: string;
  lessonId: string;
  published: boolean;
}): Promise<void> {
  await getDb(params.parishId).query(
    "UPDATE lessons SET published_at = CASE WHEN $1 THEN now() ELSE NULL END WHERE id = $2",
    [params.published, params.lessonId],
  );
}

export async function addLessonItem(params: {
  parishId: string;
  lessonId: string;
  kind: LessonItemKind;
  content: Record<string, unknown>;
}): Promise<string> {
  const { rows } = await getDb(params.parishId).query<{ id: string }>(
    `INSERT INTO lesson_items (scope, parish_id, lesson_id, position, kind, content)
     VALUES ('parish', $1, $2, COALESCE((SELECT MAX(position) + 1 FROM lesson_items WHERE lesson_id = $2), 0), $3, $4)
     RETURNING id`,
    [params.parishId, params.lessonId, params.kind, params.content],
  );
  return rows[0]!.id;
}

export async function updateLessonItem(params: {
  parishId: string;
  itemId: string;
  content: Record<string, unknown>;
}): Promise<void> {
  await getDb(params.parishId).query("UPDATE lesson_items SET content = $1 WHERE id = $2", [
    params.content,
    params.itemId,
  ]);
}

export async function deleteLessonItem(params: { parishId: string; itemId: string }): Promise<void> {
  await getDb(params.parishId).query("DELETE FROM lesson_items WHERE id = $1", [params.itemId]);
}

/** Persist a new item order. Two-phase (offset then final) to dodge the unique
 *  (lesson_id, position) constraint during the swap; runs in one transaction. */
export async function reorderLessonItems(params: {
  parishId: string;
  lessonId: string;
  orderedIds: string[];
}): Promise<void> {
  await withTenant(params.parishId, async (q) => {
    await q("UPDATE lesson_items SET position = position + 100000 WHERE lesson_id = $1", [params.lessonId]);
    for (let i = 0; i < params.orderedIds.length; i++) {
      await q("UPDATE lesson_items SET position = $1 WHERE id = $2 AND lesson_id = $3", [
        i,
        params.orderedIds[i],
        params.lessonId,
      ]);
    }
  });
}
