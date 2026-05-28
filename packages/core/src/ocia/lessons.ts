import { getDb } from "../db/client";

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
