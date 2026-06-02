import { getDb } from "../db/client";

// Shared engine for the "three-layer content" pattern: a global approved set
// (universal), per-parish wide-column overrides, and per-parish pending submissions,
// merged so the universal layer wins on a case-folded key. Dictionary and prayers are
// thin configurations over this (and a future hymns/FAQs module would be too) — the
// merge/dedupe/sort logic lives here once instead of being copied per module (po-5bp).
//
// What stays in each module: the SQL that SELECTs each layer (column lists differ) and
// the create/update of submissions (validation + columns differ). What is shared here:
// the merge, the override upsert skeleton, and the tenant-scoped delete — the parts that
// were byte-identical across modules. (`orNull` lives in @parvaordo/shared, hoisted by po-1mc.)

export interface MergeLayeredOptions<U, O, S, Item> {
  /** Global approved rows, identical for every tenant. */
  universal: U[];
  /** This parish's override rows, each pointing at a universal entry. */
  overrides: O[];
  /** This parish's pending submission rows. */
  submissions: S[];
  /** The universal entry id an override targets. */
  overrideEntryId: (override: O) => string;
  /** The id of a universal row, matched against overrideEntryId. */
  universalEntryId: (universal: U) => string;
  /** Build the item for a universal row, with its override (if any) applied. */
  fromUniversal: (universal: U, override: O | undefined) => Item;
  /** Build the item for a parish submission. */
  fromSubmission: (submission: S) => Item;
  /** Case-folded dedupe key: a submission is dropped when a universal item shares it. */
  dedupeKey: (item: Item) => string;
  /** Display key the merged list is sorted by (locale-aware). */
  sortKey: (item: Item) => string;
}

/**
 * Merge the three layers into one list: every universal entry (with its parish override
 * applied), plus each parish submission whose key no universal entry already claims —
 * universal always wins. The result is sorted by `sortKey`.
 */
export function mergeLayered<U, O, S, Item>(opts: MergeLayeredOptions<U, O, S, Item>): Item[] {
  const overrideByEntry = new Map(opts.overrides.map((o) => [opts.overrideEntryId(o), o]));
  const byKey = new Map<string, Item>();

  for (const u of opts.universal) {
    const item = opts.fromUniversal(u, overrideByEntry.get(opts.universalEntryId(u)));
    byKey.set(opts.dedupeKey(item), item);
  }
  for (const s of opts.submissions) {
    const item = opts.fromSubmission(s);
    const key = opts.dedupeKey(item);
    if (byKey.has(key)) continue; // universal (or an earlier submission) already owns this key
    byKey.set(key, item);
  }

  return [...byKey.values()].sort((a, b) => opts.sortKey(a).localeCompare(opts.sortKey(b)));
}

/** Override tables that share the (parish_id, entry_id) upsert shape. */
export type OverrideTable = "dictionary_overrides" | "prayer_overrides";
/** Submission tables that share the tenant-scoped delete. */
export type SubmissionTable = "dictionary_submissions" | "prayer_submissions";

/**
 * Upsert a per-parish override keyed by (parish_id, entry_id). Every override table
 * has the same shape — an INSERT ... ON CONFLICT DO UPDATE that differs only in which
 * override columns it carries — so `columns` maps each override column to its value.
 *
 * Safety: `table` is a fixed union and the `columns` KEYS are compile-time identifiers
 * supplied by the calling module (never request data); only the VALUES come from input
 * and they are passed as bound parameters ($3…). So nothing user-controlled is ever
 * interpolated into the statement text.
 */
export async function upsertParishOverride(
  parishId: string,
  table: OverrideTable,
  entryId: string,
  columns: Record<string, string | null>,
): Promise<void> {
  const cols = Object.keys(columns);
  const placeholders = cols.map((_, i) => `$${i + 3}`).join(", ");
  const setClause = cols.map((c) => `${c} = EXCLUDED.${c}`).join(", ");
  await getDb(parishId).query(
    `INSERT INTO ${table} (parish_id, entry_id, ${cols.join(", ")})
     VALUES ($1, $2, ${placeholders})
     ON CONFLICT (parish_id, entry_id) DO UPDATE SET ${setClause}`,
    [parishId, entryId, ...Object.values(columns)],
  );
}

/** Delete a parish's own submission — scoped by id AND parish_id so it can never reach across tenants. */
export async function deleteParishSubmission(parishId: string, table: SubmissionTable, id: string): Promise<void> {
  await getDb(parishId).query(`DELETE FROM ${table} WHERE id = $1 AND parish_id = $2`, [id, parishId]);
}
