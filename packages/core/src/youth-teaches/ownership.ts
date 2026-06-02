import { getDb } from "../db/client";

// Ownership boundary for Parvus Studio (Youth Teaches).
//
// youth_projects is parish-scoped by RLS (app.parish_id) but ALSO carries a
// teen_user_id owner. RLS isolates tenants, NOT owners — every project-scoped
// query keys only on the project id, so absent an owner check any authenticated
// parish member (another teen, or even a plain parish_member) could read or
// mutate ANY project in the parish just by supplying its UUID.
//
// Teen-facing entry points (the MCP tools, the teen web project page + its
// Server Actions, the iOS app routes) MUST gate on the helpers here before
// acting. Staff (catechist/admin) paths legitimately span the whole parish and
// stay parish-scoped — they do NOT call these.

/**
 * Raised when a teen-facing operation targets a project the caller does not own.
 * Deliberately generic ("project not found") and detail-free so a caller cannot
 * distinguish "exists but not yours" from "does not exist" and enumerate the
 * parish's project ids.
 */
export class ProjectAccessError extends Error {
  constructor(message = "project not found") {
    super(message);
    this.name = "ProjectAccessError";
  }
}

/**
 * True iff `projectId` exists in the caller's parish AND is owned by `userId`.
 *
 * Response-style call sites (route handlers, the page loader) use this and return
 * a 404 / "not found" on false. Throw-style call sites use {@link assertOwnsProject}.
 */
export async function isProjectOwner(parishId: string, userId: string, projectId: string): Promise<boolean> {
  const { rows } = await getDb(parishId).query<{ teen_user_id: string }>(
    "SELECT teen_user_id FROM youth_projects WHERE id = $1",
    [projectId],
  );
  // No row → not in this parish (RLS) or nonexistent; either way: not owned.
  return rows[0]?.teen_user_id === userId;
}

/**
 * Assert the caller owns `projectId`, else throw {@link ProjectAccessError}.
 * For throw-style call sites (the MCP dispatch, the web Server Actions).
 */
export async function assertOwnsProject(parishId: string, userId: string, projectId: string): Promise<void> {
  if (!(await isProjectOwner(parishId, userId, projectId))) {
    throw new ProjectAccessError();
  }
}
