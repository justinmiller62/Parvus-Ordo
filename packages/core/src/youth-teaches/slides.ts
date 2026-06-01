import { getDb } from "../db/client";
import { putSlide } from "./r2";

// Parvus Studio slide images. Bytes live in R2 (private); youth_slides records
// order + key so the iOS package can presign them. 1920×1080 is the target spec
// (enforced by convention / the MCP tool description, not validated here).
//
// R2 key mirrors the tenancy hierarchy so a bucket browse / lifecycle rule / export
// can be scoped per diocese or parish: {dioceseId}/{parishId}/studio/{projectId}/…
// The full key is persisted in youth_slides.r2_key, so this layout can evolve
// without migrating existing objects (presigning always reads the stored key).
async function slideKey(parishId: string, projectId: string, order: number): Promise<string> {
  const { rows } = await getDb(parishId).query<{ diocese_id: string }>(
    "SELECT diocese_id FROM parishes WHERE id = $1",
    [parishId],
  );
  const dioceseId = rows[0]?.diocese_id;
  if (!dioceseId) throw new Error("parish not found");
  return `${dioceseId}/${parishId}/studio/${projectId}/slide${order}.png`;
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

/** Store bytes as the project's slide at `order` (replacing that order if present). */
export async function addProjectSlide(
  parishId: string,
  projectId: string,
  order: number,
  bytes: ArrayBuffer | Uint8Array,
  contentType = "image/png",
): Promise<{ r2Key: string }> {
  const key = await slideKey(parishId, projectId, order);
  await putSlide(key, bytes, contentType);
  await getDb(parishId).query(
    `INSERT INTO youth_slides (parish_id, project_id, slide_order, r2_key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, slide_order) DO UPDATE SET r2_key = EXCLUDED.r2_key`,
    [parishId, projectId, order, key],
  );
  return { r2Key: key };
}

export async function deleteProjectSlide(parishId: string, projectId: string, order: number): Promise<void> {
  await getDb(parishId).query("DELETE FROM youth_slides WHERE project_id = $1 AND slide_order = $2", [projectId, order]);
}
