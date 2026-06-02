import { resolveEnabled, type ModuleKey } from "@parvaordo/shared";
import { getDb } from "../db/client";

/**
 * The modules enabled for a parish (RFC-001 §3.2/§3.3): the registry defaults overlaid by
 * the parish's DIOCESE rows, then the parish's OWN rows — most-specific wins — via the pure
 * 3-layer `resolveEnabled`. SPARSE-ROW semantics: a parish with no rows gets every
 * default-enabled module, and a non-toggleable module stays on regardless of any row. Both
 * reads run inside the single tenant transaction, so RLS scopes parish_modules by
 * app.parish_id and diocese_modules by app.diocese_id (the active parish's diocese) — this
 * only ever sees its own parish + diocese rows, never another tenant's; a parish with no
 * diocese sees no diocese rows (app.diocese_id is unset). Core stays pure: it takes a
 * parishId, not a viewer.
 */
export async function enabledModules(parishId: string): Promise<Set<ModuleKey>> {
  const { rows } = await getDb(parishId).query<{ layer: "parish" | "diocese"; module_key: string; enabled: boolean }>(
    `SELECT 'parish' AS layer, module_key, enabled FROM parish_modules
     UNION ALL
     SELECT 'diocese' AS layer, module_key, enabled FROM diocese_modules`,
  );
  return resolveEnabled({
    parish: rows.filter((r) => r.layer === "parish"),
    diocese: rows.filter((r) => r.layer === "diocese"),
  });
}
