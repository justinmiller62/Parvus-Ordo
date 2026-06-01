import { getDb, withTenant } from "../db/client";
import { putSlide } from "./r2";

// Parvus Studio slide images. Bytes live in R2 (private); youth_slides records
// order + key so the iOS package can presign them. 1920×1080 is the target spec
// (enforced by convention / the MCP tool description, not validated here).
//
// R2 key mirrors the tenancy hierarchy so a bucket browse / lifecycle rule / export
// can be scoped per diocese or parish: {dioceseId}/{parishId}/studio/{projectId}/…
// The object id is random (NOT the order) so reordering never has to move objects;
// the full key is persisted in youth_slides.r2_key and presigning reads it.
async function slideKey(parishId: string, projectId: string): Promise<string> {
  const { rows } = await getDb(parishId).query<{ diocese_id: string }>(
    "SELECT diocese_id FROM parishes WHERE id = $1",
    [parishId],
  );
  const dioceseId = rows[0]?.diocese_id;
  if (!dioceseId) throw new Error("parish not found");
  return `${dioceseId}/${parishId}/studio/${projectId}/${crypto.randomUUID()}.png`;
}

export interface ProjectSlide {
  id: string;
  order: number;
  r2Key: string;
}

export async function listProjectSlides(parishId: string, projectId: string): Promise<ProjectSlide[]> {
  const { rows } = await getDb(parishId).query<{ id: string; slide_order: number; r2_key: string }>(
    "SELECT id, slide_order, r2_key FROM youth_slides WHERE project_id = $1 ORDER BY slide_order",
    [projectId],
  );
  return rows.map((r) => ({ id: r.id, order: r.slide_order, r2Key: r.r2_key }));
}

/** Next append position (1-based) for a new slide. */
export async function nextSlideOrder(parishId: string, projectId: string): Promise<number> {
  const { rows } = await getDb(parishId).query<{ next: string }>(
    "SELECT COALESCE(MAX(slide_order), 0) + 1 AS next FROM youth_slides WHERE project_id = $1",
    [projectId],
  );
  return Number(rows[0]!.next);
}

/** Store bytes as the project's slide at `order` (replacing that order if present). */
export async function addProjectSlide(
  parishId: string,
  projectId: string,
  order: number,
  bytes: ArrayBuffer | Uint8Array,
  contentType = "image/png",
): Promise<{ id: string; r2Key: string }> {
  const key = await slideKey(parishId, projectId);
  await putSlide(key, bytes, contentType);
  const { rows } = await getDb(parishId).query<{ id: string }>(
    `INSERT INTO youth_slides (parish_id, project_id, slide_order, r2_key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, slide_order) DO UPDATE SET r2_key = EXCLUDED.r2_key
     RETURNING id`,
    [parishId, projectId, order, key],
  );
  return { id: rows[0]!.id, r2Key: key };
}

/** Persist a new slide ordering. Two-phase within a transaction so the
 * UNIQUE(project_id, slide_order) constraint isn't tripped mid-renumber. */
export async function reorderProjectSlides(parishId: string, projectId: string, orderedIds: string[]): Promise<void> {
  await withTenant(parishId, async (q) => {
    await q("UPDATE youth_slides SET slide_order = slide_order + 1000 WHERE project_id = $1", [projectId]);
    for (let i = 0; i < orderedIds.length; i++) {
      await q("UPDATE youth_slides SET slide_order = $3 WHERE id = $1 AND project_id = $2", [orderedIds[i], projectId, i + 1]);
    }
  });
}

export async function deleteProjectSlide(parishId: string, projectId: string, slideId: string): Promise<void> {
  await getDb(parishId).query("DELETE FROM youth_slides WHERE id = $1 AND project_id = $2", [slideId, projectId]);
}
