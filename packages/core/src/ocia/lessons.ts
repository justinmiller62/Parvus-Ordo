import { getDb, withTenant, type TenantQuery } from "../db/client";

export type ContentScope = "global" | "diocese" | "parish";
export type LessonItemKind = "reading" | "video" | "question";
export type LessonStatus = "published" | "draft" | "offline";

export interface LessonItem {
  id: string;
  position: number;
  kind: LessonItemKind;
  content: Record<string, unknown>;
}

export interface LessonDetail {
  lessonId: string;
  versionId: string;
  title: string;
  description: string | null;
  scope: ContentScope;
  items: LessonItem[];
}

export interface PublishedLessonRow {
  id: string;
  title: string;
  scope: ContentScope;
  lessonOrder: number;
}

export interface ManageLessonRow {
  id: string;
  title: string;
  scope: ContentScope;
  lessonOrder: number;
  status: LessonStatus;
  updatedAt: string;
  isFork: boolean;
}

export interface VersionSummary {
  id: string;
  versionNumber: number;
  publishedAt: string | null;
  updatedAt: string;
  isLive: boolean;
  isDraft: boolean;
}

export interface LessonForEdit {
  lessonId: string;
  scope: ContentScope;
  editable: boolean;
  liveVersionId: string | null;
  draftVersionId: string | null;
  selected: {
    versionId: string;
    title: string;
    description: string | null;
    isDraft: boolean;
    isLive: boolean;
    items: LessonItem[];
  };
  versions: VersionSummary[];
}

// pg returns timestamptz as a JS Date; normalise to an ISO string so sorting/
// formatting are predictable.
function toIso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : v == null ? "" : String(v);
}

type ItemRow = { id: string; position: number; kind: LessonItemKind; content: Record<string, unknown> };

async function itemsFor(
  query: (sql: string, params?: unknown[]) => Promise<{ rows: ItemRow[] }>,
  versionId: string,
): Promise<LessonItem[]> {
  const { rows } = await query(
    "SELECT id, position, kind, content FROM lesson_items WHERE version_id = $1 ORDER BY position",
    [versionId],
  );
  return rows.map((r) => ({ id: r.id, position: r.position, kind: r.kind, content: r.content }));
}

// ── Student reads ──────────────────────────────────────────────────────────

/** Published lessons visible to a parish (each has a live version). */
export async function getPublishedLessons(parishId: string): Promise<PublishedLessonRow[]> {
  const { rows } = await getDb(parishId).query<{
    id: string;
    title: string;
    scope: ContentScope;
    lesson_order: number;
  }>(
    `SELECT l.id, lv.title, l.scope, l.lesson_order
       FROM lessons l
       JOIN lesson_versions lv ON lv.id = l.live_version_id
      ORDER BY l.scope, l.lesson_order, lv.title`,
  );
  return rows.map((r) => ({ id: r.id, title: r.title, scope: r.scope, lessonOrder: r.lesson_order }));
}

/**
 * The content of a lesson for viewing. Defaults to the LIVE version (students);
 * a specific versionId may be passed for builder preview (must belong to lessonId).
 */
export async function getLessonDetail(
  parishId: string,
  lessonId: string,
  versionId?: string,
): Promise<LessonDetail | null> {
  const db = getDb(parishId);

  let v: { id: string; title: string; description: string | null; scope: ContentScope } | undefined;
  if (versionId) {
    const { rows } = await db.query<{
      id: string;
      title: string;
      description: string | null;
      scope: ContentScope;
      lesson_id: string;
    }>("SELECT id, title, description, scope, lesson_id FROM lesson_versions WHERE id = $1", [versionId]);
    if (!rows[0] || rows[0].lesson_id !== lessonId) return null;
    v = rows[0];
  } else {
    const { rows } = await db.query<{
      id: string;
      title: string;
      description: string | null;
      scope: ContentScope;
    }>(
      `SELECT lv.id, lv.title, lv.description, lv.scope
         FROM lessons l JOIN lesson_versions lv ON lv.id = l.live_version_id
        WHERE l.id = $1`,
      [lessonId],
    );
    v = rows[0];
  }
  if (!v) return null;

  const items = await itemsFor((sql, params) => db.query<ItemRow>(sql, params), v.id);
  return { lessonId, versionId: v.id, title: v.title, description: v.description, scope: v.scope, items };
}

// ── Builder reads ────────────────────────────────────────────────────────────

/** All lessons visible to a parish, with status — for the manage list. Supports
 *  filtering by scope/status and sorting (applied in JS; parish lists are small). */
export async function getManageLessons(
  parishId: string,
  opts: { scope?: ContentScope; status?: LessonStatus; sort?: "title" | "updated" } = {},
): Promise<ManageLessonRow[]> {
  const { rows } = await getDb(parishId).query<{
    id: string;
    title: string;
    scope: ContentScope;
    lesson_order: number;
    is_fork: boolean;
    is_published: boolean;
    has_draft: boolean;
    updated_at: string;
  }>(
    `SELECT l.id, l.scope, l.lesson_order,
            (l.source_lesson_id IS NOT NULL) AS is_fork,
            COALESCE(live.title, latest.title) AS title,
            latest.updated_at AS updated_at,
            (l.live_version_id IS NOT NULL) AS is_published,
            EXISTS (SELECT 1 FROM lesson_versions d WHERE d.lesson_id = l.id AND d.published_at IS NULL) AS has_draft
       FROM lessons l
       LEFT JOIN lesson_versions live ON live.id = l.live_version_id
       LEFT JOIN LATERAL (
         SELECT title, updated_at FROM lesson_versions v WHERE v.lesson_id = l.id ORDER BY v.version_number DESC LIMIT 1
       ) latest ON true`,
  );

  let result: ManageLessonRow[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    scope: r.scope,
    lessonOrder: r.lesson_order,
    status: r.is_published ? "published" : r.has_draft ? "draft" : "offline",
    updatedAt: toIso(r.updated_at),
    isFork: r.is_fork,
  }));

  if (opts.scope) result = result.filter((l) => l.scope === opts.scope);
  if (opts.status) result = result.filter((l) => l.status === opts.status);
  result.sort((a, b) =>
    opts.sort === "updated" ? b.updatedAt.localeCompare(a.updatedAt) : a.title.localeCompare(b.title),
  );
  return result;
}

/** A lesson + its versions for the builder. Defaults to viewing the draft (else
 *  live, else latest); a selectedVersionId picks a specific version to view. */
export async function getLessonForEdit(
  parishId: string,
  lessonId: string,
  selectedVersionId?: string,
): Promise<LessonForEdit | null> {
  const db = getDb(parishId);

  const { rows: lrows } = await db.query<{
    id: string;
    scope: ContentScope;
    parish_id: string | null;
    live_version_id: string | null;
  }>("SELECT id, scope, parish_id, live_version_id FROM lessons WHERE id = $1", [lessonId]);
  const l = lrows[0];
  if (!l) return null;

  const { rows: vrows } = await db.query<{
    id: string;
    version_number: number;
    published_at: string | null;
    updated_at: string;
  }>(
    "SELECT id, version_number, published_at, updated_at FROM lesson_versions WHERE lesson_id = $1 ORDER BY version_number DESC",
    [lessonId],
  );

  const versions: VersionSummary[] = vrows.map((v) => ({
    id: v.id,
    versionNumber: v.version_number,
    publishedAt: v.published_at ? toIso(v.published_at) : null,
    updatedAt: toIso(v.updated_at),
    isLive: v.id === l.live_version_id,
    isDraft: v.published_at === null,
  }));

  const draft = versions.find((v) => v.isDraft) ?? null;
  const selId =
    selectedVersionId && versions.some((v) => v.id === selectedVersionId)
      ? selectedVersionId
      : (draft?.id ?? l.live_version_id ?? versions[0]?.id);
  if (!selId) return null;

  const { rows: srows } = await db.query<{
    id: string;
    title: string;
    description: string | null;
    published_at: string | null;
  }>("SELECT id, title, description, published_at FROM lesson_versions WHERE id = $1", [selId]);
  const s = srows[0]!;
  const items = await itemsFor((sql, params) => db.query<ItemRow>(sql, params), selId);

  return {
    lessonId,
    scope: l.scope,
    editable: l.scope === "parish" && l.parish_id === parishId,
    liveVersionId: l.live_version_id,
    draftVersionId: draft?.id ?? null,
    selected: {
      versionId: selId,
      title: s.title,
      description: s.description,
      isDraft: s.published_at === null,
      isLive: selId === l.live_version_id,
      items,
    },
    versions,
  };
}

/**
 * Whether a lesson version may be edited: it must be a parish-owned DRAFT — scope
 * 'parish', belonging to THIS parish, and not yet published. This is the single source
 * of the edit-gate rule (the web edit actions delegate to it); it extends
 * getLessonForEdit's `editable` (scope/parish ownership) with the unpublished-draft
 * requirement. The parish_id check is defense in depth: getDb already RLS-scopes the
 * read, but global/diocese versions are RLS-readable yet never parish-editable.
 */
export async function isEditableDraft(parishId: string, versionId: string): Promise<boolean> {
  const { rows } = await getDb(parishId).query<{
    published_at: string | null;
    scope: ContentScope;
    parish_id: string | null;
  }>("SELECT published_at, scope, parish_id FROM lesson_versions WHERE id = $1", [versionId]);
  const v = rows[0];
  return !!v && v.scope === "parish" && v.parish_id === parishId && v.published_at === null;
}

/** Read a single lesson item's content JSON (tenant-scoped), or `{}` if it doesn't
 *  exist. Used by the edit shim to merge content updates and find a prior cut clip. */
export async function getLessonItemContent(parishId: string, itemId: string): Promise<Record<string, unknown>> {
  const { rows } = await getDb(parishId).query<{ content: Record<string, unknown> }>(
    "SELECT content FROM lesson_items WHERE id = $1",
    [itemId],
  );
  return rows[0]?.content ?? {};
}

// ── Mutations ────────────────────────────────────────────────────────────────

export async function createLesson(params: { parishId: string; createdBy: string; title?: string }): Promise<string> {
  return withTenant(params.parishId, async (q) => {
    const [lesson] = await q<{ id: string }>(
      "INSERT INTO lessons (scope, parish_id, created_by) VALUES ('parish', $1, $2) RETURNING id",
      [params.parishId, params.createdBy],
    );
    await q(
      "INSERT INTO lesson_versions (lesson_id, scope, parish_id, version_number, title) VALUES ($1, 'parish', $2, 1, $3)",
      [lesson!.id, params.parishId, params.title?.trim() || "Untitled lesson"],
    );
    return lesson!.id;
  });
}

/** Return the lesson's draft version id, creating one (a copy of the live/latest
 *  version) if none exists. Parish-owned lessons only. */
export async function ensureDraft(parishId: string, lessonId: string): Promise<string> {
  return withTenant(parishId, async (q) => {
    const existing = await q<{ id: string }>(
      "SELECT id FROM lesson_versions WHERE lesson_id = $1 AND published_at IS NULL",
      [lessonId],
    );
    if (existing[0]) return existing[0].id;

    const [lrow] = await q<{ live_version_id: string | null }>("SELECT live_version_id FROM lessons WHERE id = $1", [
      lessonId,
    ]);
    const [latest] = await q<{ id: string }>(
      "SELECT id FROM lesson_versions WHERE lesson_id = $1 ORDER BY version_number DESC LIMIT 1",
      [lessonId],
    );
    const sourceId = lrow?.live_version_id ?? latest?.id;
    const [src] = await q<{
      title: string;
      description: string | null;
      scope: string;
      parish_id: string | null;
      diocese_id: string | null;
    }>("SELECT title, description, scope, parish_id, diocese_id FROM lesson_versions WHERE id = $1", [sourceId]);
    const countRows = await q<{ n: number }>(
      "SELECT COALESCE(MAX(version_number), 0) + 1 AS n FROM lesson_versions WHERE lesson_id = $1",
      [lessonId],
    );
    const n = countRows[0]!.n;
    const [draft] = await q<{ id: string }>(
      `INSERT INTO lesson_versions (lesson_id, scope, parish_id, diocese_id, version_number, title, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [lessonId, src!.scope, src!.parish_id, src!.diocese_id, n, src!.title, src!.description],
    );
    await q(
      `INSERT INTO lesson_items (scope, parish_id, diocese_id, version_id, position, kind, content)
       SELECT scope, parish_id, diocese_id, $1, position, kind, content FROM lesson_items WHERE version_id = $2`,
      [draft!.id, sourceId],
    );
    return draft!.id;
  });
}

export async function addLessonItem(params: {
  parishId: string;
  versionId: string;
  kind: LessonItemKind;
  content: Record<string, unknown>;
}): Promise<string> {
  const { rows } = await getDb(params.parishId).query<{ id: string }>(
    `INSERT INTO lesson_items (scope, parish_id, version_id, position, kind, content)
     SELECT lv.scope, lv.parish_id, $1,
            COALESCE((SELECT MAX(position) + 1 FROM lesson_items WHERE version_id = $1), 0), $2, $3
       FROM lesson_versions lv WHERE lv.id = $1
     RETURNING id`,
    [params.versionId, params.kind, params.content],
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

export async function reorderLessonItems(params: {
  parishId: string;
  versionId: string;
  orderedIds: string[];
}): Promise<void> {
  await withTenant(params.parishId, async (q: TenantQuery) => {
    await q("UPDATE lesson_items SET position = position + 100000 WHERE version_id = $1", [params.versionId]);
    for (let i = 0; i < params.orderedIds.length; i++) {
      await q("UPDATE lesson_items SET position = $1 WHERE id = $2 AND version_id = $3", [
        i,
        params.orderedIds[i],
        params.versionId,
      ]);
    }
  });
}

export async function updateVersionMeta(params: {
  parishId: string;
  versionId: string;
  title: string;
  description: string | null;
}): Promise<void> {
  await getDb(params.parishId).query("UPDATE lesson_versions SET title = $1, description = $2 WHERE id = $3", [
    params.title.trim() || "Untitled lesson",
    params.description,
    params.versionId,
  ]);
}

/** Publish a version and make it live (also used to "make live" / roll back an
 *  already-published version). */
export async function publishVersion(params: { parishId: string; lessonId: string; versionId: string }): Promise<void> {
  await withTenant(params.parishId, async (q) => {
    await q("UPDATE lesson_versions SET published_at = COALESCE(published_at, now()) WHERE id = $1", [
      params.versionId,
    ]);
    await q("UPDATE lessons SET live_version_id = $1 WHERE id = $2", [params.versionId, params.lessonId]);
  });
}

/** Take the lesson offline (no live version). Versions/history are retained. */
export async function unpublishLesson(params: { parishId: string; lessonId: string }): Promise<void> {
  await getDb(params.parishId).query("UPDATE lessons SET live_version_id = NULL WHERE id = $1", [params.lessonId]);
}

/** Delete a whole lesson (versions, items, answers, progress cascade). RLS
 *  restricts this to parish-owned lessons. */
export async function deleteLesson(parishId: string, lessonId: string): Promise<void> {
  await getDb(parishId).query("DELETE FROM lessons WHERE id = $1", [lessonId]);
}

/** Delete a single version (discard a draft, or remove a historical version).
 *  Refuses to delete the live version or the lesson's only version. */
export async function deleteVersion(params: { parishId: string; lessonId: string; versionId: string }): Promise<void> {
  await withTenant(params.parishId, async (q) => {
    const live = await q<{ live_version_id: string | null }>("SELECT live_version_id FROM lessons WHERE id = $1", [
      params.lessonId,
    ]);
    if (live[0]?.live_version_id === params.versionId) {
      throw new Error("cannot delete the live version — unpublish or make another version live first");
    }
    const counted = await q<{ c: number }>("SELECT COUNT(*)::int AS c FROM lesson_versions WHERE lesson_id = $1", [
      params.lessonId,
    ]);
    if ((counted[0]?.c ?? 0) <= 1) {
      throw new Error("cannot delete the only version — delete the lesson instead");
    }
    await q("DELETE FROM lesson_versions WHERE id = $1", [params.versionId]);
  });
}

/** Fork a global/diocese lesson into a new parish-owned, published copy. */
export async function forkLesson(params: {
  parishId: string;
  createdBy: string;
  sourceLessonId: string;
}): Promise<string> {
  return withTenant(params.parishId, async (q) => {
    const [src] = await q<{ live_version_id: string | null }>("SELECT live_version_id FROM lessons WHERE id = $1", [
      params.sourceLessonId,
    ]);
    const [latest] = await q<{ id: string }>(
      "SELECT id FROM lesson_versions WHERE lesson_id = $1 ORDER BY version_number DESC LIMIT 1",
      [params.sourceLessonId],
    );
    const sourceVersionId = src?.live_version_id ?? latest?.id;
    if (!sourceVersionId) throw new Error("source lesson has no content to fork");

    const [meta] = await q<{ title: string; description: string | null }>(
      "SELECT title, description FROM lesson_versions WHERE id = $1",
      [sourceVersionId],
    );

    const [lesson] = await q<{ id: string }>(
      "INSERT INTO lessons (scope, parish_id, source_lesson_id, created_by) VALUES ('parish', $1, $2, $3) RETURNING id",
      [params.parishId, params.sourceLessonId, params.createdBy],
    );
    const [version] = await q<{ id: string }>(
      `INSERT INTO lesson_versions (lesson_id, scope, parish_id, version_number, title, description, published_at)
       VALUES ($1, 'parish', $2, 1, $3, $4, now()) RETURNING id`,
      [lesson!.id, params.parishId, meta!.title, meta!.description],
    );
    await q(
      `INSERT INTO lesson_items (scope, parish_id, version_id, position, kind, content)
       SELECT 'parish', $1, $2, position, kind, content FROM lesson_items WHERE version_id = $3`,
      [params.parishId, version!.id, sourceVersionId],
    );
    await q("UPDATE lessons SET live_version_id = $1 WHERE id = $2", [version!.id, lesson!.id]);
    return lesson!.id;
  });
}
