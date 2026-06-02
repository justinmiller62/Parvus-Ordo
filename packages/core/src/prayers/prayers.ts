import { orNull, trimOrEmpty } from "@parvaordo/shared";
import { getDb } from "../db/client";
import { deleteParishSubmission, mergeLayered, upsertParishOverride } from "../content/layered";

// Prayer Book data access — mirrors the dictionary three-layer model: global
// prayer_entries (approved) + per-parish prayer_overrides + prayer_submissions,
// merged by the shared mergeLayered engine in ../content/layered.

export interface PrayerItem {
  id: string;
  title: string;
  prayerText: string;
  latinText: string | null;
  category: string | null;
  context: string | null;
  attribution: string | null;
  isLocal: boolean;
  overrideNote: string | null;
}

export interface NewPrayerInput {
  title: string;
  prayerText: string;
  latinText?: string | null;
  category?: string | null;
  context?: string | null;
  attribution?: string | null;
}

// Universal entries and parish submissions select the same columns.
interface PrayerRow {
  id: string;
  title: string;
  prayer_text: string;
  latin_text: string | null;
  category: string | null;
  context: string | null;
  attribution: string | null;
}

interface OverrideRow {
  entry_id: string;
  override_text: string | null;
  override_context: string | null;
  override_notes: string | null;
}

/** All prayers a parish sees: approved universal prayers (with this parish's
 * overrides applied) + the parish's pending submissions (universal wins on title). */
export async function listPrayers(parishId: string): Promise<PrayerItem[]> {
  const db = getDb(parishId);
  const [{ rows: universal }, { rows: overrides }, { rows: submissions }] = await Promise.all([
    db.query<PrayerRow>(
      `SELECT id, title, prayer_text, latin_text, category, context, attribution
         FROM prayer_entries WHERE status = 'approved' ORDER BY display_order, title`,
    ),
    db.query<OverrideRow>("SELECT entry_id, override_text, override_context, override_notes FROM prayer_overrides"),
    db.query<PrayerRow>(
      `SELECT id, title, prayer_text, latin_text, category, context, attribution
         FROM prayer_submissions WHERE status = 'pending' ORDER BY title`,
    ),
  ]);

  return mergeLayered<PrayerRow, OverrideRow, PrayerRow, PrayerItem>({
    universal,
    overrides,
    submissions,
    overrideEntryId: (o) => o.entry_id,
    universalEntryId: (p) => p.id,
    fromUniversal: (p, o) => ({
      id: p.id,
      title: p.title,
      prayerText: o?.override_text ?? p.prayer_text,
      latinText: p.latin_text,
      category: p.category,
      context: o?.override_context ?? p.context,
      attribution: p.attribution,
      isLocal: false,
      overrideNote: o?.override_notes ?? null,
    }),
    fromSubmission: (s) => ({
      id: s.id,
      title: s.title,
      prayerText: s.prayer_text,
      latinText: s.latin_text,
      category: s.category,
      context: s.context,
      attribution: s.attribution,
      isLocal: true,
      overrideNote: null,
    }),
    dedupeKey: (it) => it.title.toLowerCase(),
    sortKey: (it) => it.title,
  });
}

/** Create a parish prayer submission (pending). Null if title/text empty. */
export async function createPrayerSubmission(
  parishId: string,
  submittedBy: string,
  input: NewPrayerInput,
): Promise<{ id: string } | null> {
  const title = trimOrEmpty(input.title);
  const text = trimOrEmpty(input.prayerText);
  if (!title || !text) return null;
  const { rows } = await getDb(parishId).query<{ id: string }>(
    `INSERT INTO prayer_submissions (parish_id, title, prayer_text, latin_text, category, context, attribution, submitted_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      parishId,
      title,
      text,
      orNull(input.latinText),
      orNull(input.category),
      orNull(input.context),
      orNull(input.attribution),
      submittedBy,
    ],
  );
  return { id: rows[0]!.id };
}

export async function updatePrayerSubmission(parishId: string, id: string, input: NewPrayerInput): Promise<void> {
  await getDb(parishId).query(
    `UPDATE prayer_submissions SET title=$3, prayer_text=$4, latin_text=$5, category=$6, context=$7, attribution=$8
      WHERE id=$1 AND parish_id=$2`,
    [
      id,
      parishId,
      trimOrEmpty(input.title),
      trimOrEmpty(input.prayerText),
      orNull(input.latinText),
      orNull(input.category),
      orNull(input.context),
      orNull(input.attribution),
    ],
  );
}

export async function deletePrayerSubmission(parishId: string, id: string): Promise<void> {
  await deleteParishSubmission(parishId, "prayer_submissions", id);
}

/** Upsert a per-parish override of a universal prayer (text/context). */
export async function upsertPrayerOverride(
  parishId: string,
  entryId: string,
  o: { text?: string | null; context?: string | null; notes?: string | null },
): Promise<void> {
  await upsertParishOverride(parishId, "prayer_overrides", entryId, {
    override_text: orNull(o.text),
    override_context: orNull(o.context),
    override_notes: orNull(o.notes),
  });
}
