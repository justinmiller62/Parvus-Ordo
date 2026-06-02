import { getDb } from "../db";
import type { CalendarSource } from "./types";
import type { ContentScope } from "../ocia/lessons";

// calendar_sources — external iCal feeds (live-fetched, never synced). The calendar read
// path uses listEnabledSources (every viewer, incl. students, sees only enabled feeds);
// the full list + CRUD are reached only through admin/catechist-gated Server Actions, so
// disabled feeds never leak to students (PO enforces role at the boundary, not in RLS).
// Saving validates shape only — the host whitelist is applied at FETCH time (ical.fetchFeed),
// so an admin can stage a feed before its host is allow-listed via ICAL_ALLOWED_HOSTS.

interface CalendarSourceRow {
  id: string;
  scope: ContentScope;
  name: string;
  url: string;
  color: string;
  enabled: boolean;
  display_order: number;
}

function rowToSource(r: CalendarSourceRow): CalendarSource {
  return {
    id: r.id,
    scope: r.scope,
    name: r.name,
    url: r.url,
    color: r.color,
    enabled: r.enabled,
    displayOrder: r.display_order,
  };
}

const SOURCE_COLUMNS = `id, scope, name, url, color, enabled, display_order`;
const ORDER = `ORDER BY display_order, name`;

/** Enabled feeds visible to the parish (own + diocese + global, via RLS). The calendar
 *  read path — what every viewer, including students, gets. */
export async function listEnabledSources(parishId: string): Promise<CalendarSource[]> {
  const { rows } = await getDb(parishId).query<CalendarSourceRow>(
    `SELECT ${SOURCE_COLUMNS} FROM calendar_sources WHERE enabled = true ${ORDER}`,
  );
  return rows.map(rowToSource);
}

/** All feeds (enabled + disabled) for the admin UI — reached only via role-gated actions. */
export async function listAllSources(parishId: string): Promise<CalendarSource[]> {
  const { rows } = await getDb(parishId).query<CalendarSourceRow>(
    `SELECT ${SOURCE_COLUMNS} FROM calendar_sources ${ORDER}`,
  );
  return rows.map(rowToSource);
}

export interface CalendarSourceInput {
  name: string;
  url: string;
  color?: string;
  enabled?: boolean;
  displayOrder?: number;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Validate the shape the DB CHECK constraints also enforce. Throws on invalid input. */
function validate(input: CalendarSourceInput): Required<Omit<CalendarSourceInput, "color">> & { color: string } {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 200) throw new Error("Source name must be 1–200 characters");
  const url = input.url.trim();
  if (!/^https:\/\//i.test(url) || url.length < 12 || url.length > 2048)
    throw new Error("Source URL must be https:// and 12–2048 characters");
  const color = input.color && HEX_COLOR.test(input.color) ? input.color : "#3b82f6";
  return { name, url, color, enabled: input.enabled ?? true, displayOrder: input.displayOrder ?? 0 };
}

export async function createSource(
  parishId: string,
  createdBy: string,
  input: CalendarSourceInput,
): Promise<string | null> {
  const v = validate(input);
  const { rows } = await getDb(parishId).query<{ id: string }>(
    `INSERT INTO calendar_sources (scope, parish_id, name, url, color, enabled, display_order, created_by)
     VALUES ('parish', $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [parishId, v.name, v.url, v.color, v.enabled, v.displayOrder, createdBy],
  );
  return rows[0]?.id ?? null;
}

export async function updateSource(parishId: string, id: string, input: CalendarSourceInput): Promise<void> {
  const v = validate(input);
  await getDb(parishId).query(
    `UPDATE calendar_sources SET name = $2, url = $3, color = $4, enabled = $5, display_order = $6 WHERE id = $1`,
    [id, v.name, v.url, v.color, v.enabled, v.displayOrder],
  );
}

/** Toggle a feed on/off (the common admin action) without re-sending the whole row. */
export async function setSourceEnabled(parishId: string, id: string, enabled: boolean): Promise<void> {
  await getDb(parishId).query(`UPDATE calendar_sources SET enabled = $2 WHERE id = $1`, [id, enabled]);
}

export async function deleteSource(parishId: string, id: string): Promise<void> {
  await getDb(parishId).query(`DELETE FROM calendar_sources WHERE id = $1`, [id]);
}
