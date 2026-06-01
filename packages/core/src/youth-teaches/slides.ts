import { getDb } from "../db/client";
import { putSlide } from "./r2";

// Parvus Studio slide images. Bytes live in R2 (private); youth_slides records
// order + key so the iOS package can presign them. 1920×1080 is the target spec
// (enforced by convention / the MCP tool description, not validated here).

const slideKey = (projectId: string, order: number) => `studio-slides/${projectId}/slide${order}.png`;

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
  const key = slideKey(projectId, order);
  await putSlide(key, bytes, contentType);
  await getDb(parishId).query(
    `INSERT INTO youth_slides (parish_id, project_id, slide_order, r2_key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, slide_order) DO UPDATE SET r2_key = EXCLUDED.r2_key`,
    [parishId, projectId, order, key],
  );
  return { r2Key: key };
}

/** Fetch a public image URL and store it as a slide (the MCP upload_slide path). */
export async function addProjectSlideFromUrl(
  parishId: string,
  projectId: string,
  order: number,
  url: string,
): Promise<{ r2Key: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch slide image failed (${res.status})`);
  const contentType = res.headers.get("content-type") ?? "image/png";
  const bytes = new Uint8Array(await res.arrayBuffer());
  return addProjectSlide(parishId, projectId, order, bytes, contentType);
}

export async function deleteProjectSlide(parishId: string, projectId: string, order: number): Promise<void> {
  await getDb(parishId).query("DELETE FROM youth_slides WHERE project_id = $1 AND slide_order = $2", [projectId, order]);
}
