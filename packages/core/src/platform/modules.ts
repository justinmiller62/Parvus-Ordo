import { MODULES, resolveEnabled, type ModuleKey } from "@parvaordo/shared";
import { getDb } from "../db/client";

/**
 * The modules enabled for a parish (RFC-001 §3.2/§3.3): the parish's sparse
 * `parish_modules` rows overlaid onto the registry defaults via the pure `resolveEnabled`.
 * SPARSE-ROW semantics — a parish with no rows gets every default-enabled module; a
 * non-toggleable module stays on regardless of any row. RLS scopes the read to the active
 * parish, so this only ever sees its own rows (cross-parish reads return nothing). Core
 * stays pure: it takes a parishId, not a viewer.
 */
export async function enabledModules(parishId: string): Promise<Set<ModuleKey>> {
  const { rows } = await getDb(parishId).query<{ module_key: string; enabled: boolean }>(
    "SELECT module_key, enabled FROM parish_modules",
  );
  return resolveEnabled(rows, MODULES);
}
