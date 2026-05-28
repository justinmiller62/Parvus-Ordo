import type { Role } from "@parvaordo/shared";
import { getDb } from "../db/client";

export interface AppIdentity {
  userId: string;
  displayName: string;
  isSuperAdmin: boolean;
  /** Null when the authenticated user has no membership yet (e.g. fresh signup). */
  role: Role | null;
  parishId: string | null;
}

/**
 * Map an authenticated email to the app's role/parish via the login_lookup
 * SECURITY DEFINER function (cross-tenant, pre-tenant-context). Returns null
 * when no matching user exists.
 */
export async function lookupAppUser(email: string): Promise<AppIdentity | null> {
  const { rows } = await getDb(null).query<{
    user_id: string;
    display_name: string;
    is_super_admin: boolean;
    role: Role | null;
    parish_id: string | null;
  }>("SELECT user_id, display_name, is_super_admin, role, parish_id FROM login_lookup($1)", [email]);

  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.user_id,
    displayName: row.display_name,
    isSuperAdmin: row.is_super_admin,
    role: row.role,
    parishId: row.parish_id,
  };
}
