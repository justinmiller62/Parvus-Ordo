import { orNull, trimOrEmpty } from "@parvaordo/shared";
import { getDb } from "../db/client";

// Prayer Book data access — mirrors the dictionary three-layer model: global
// prayer_entries (approved) + per-parish prayer_overrides + prayer_submissions.

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

/** All prayers a parish sees: approved universal prayers (with this parish's
 * overrides applied) + the parish's pending submissions (universal wins on title). */
export async function listPrayers(parishId: string): Promise<PrayerItem[]> {
  const db = getDb(parishId);
  const [{ rows: universal }, { rows: overrides }, { rows: submissions }] = await Promise.all([
    db.query<{
      id: string;
      title: string;
      prayer_text: string;
      latin_text: string | null;
      category: string | null;
      context: string | null;
      attribution: string | null;
    }>(
      `SELECT id, title, prayer_text, latin_text, category, context, attribution
         FROM prayer_entries WHERE status = 'approved' ORDER BY display_order, title`,
    ),
    db.query<{
      entry_id: string;
      override_text: string | null;
      override_context: string | null;
      override_notes: string | null;
    }>("SELECT entry_id, override_text, override_context, override_notes FROM prayer_overrides"),
    db.query<{
      id: string;
      title: string;
      prayer_text: string;
      latin_text: string | null;
      category: string | null;
      context: string | null;
      attribution: string | null;
    }>(
      `SELECT id, title, prayer_text, latin_text, category, context, attribution
         FROM prayer_submissions WHERE status = 'pending' ORDER BY title`,
    ),
  ]);

  const ovByEntry = new Map(overrides.map((o) => [o.entry_id, o]));
  const byTitle = new Map<string, PrayerItem>();

  for (const p of universal) {
    const o = ovByEntry.get(p.id);
    byTitle.set(p.title.toLowerCase(), {
      id: p.id,
      title: p.title,
      prayerText: o?.override_text ?? p.prayer_text,
      latinText: p.latin_text,
      category: p.category,
      context: o?.override_context ?? p.context,
      attribution: p.attribution,
      isLocal: false,
      overrideNote: o?.override_notes ?? null,
    });
  }
  for (const s of submissions) {
    const key = s.title.toLowerCase();
    if (byTitle.has(key)) continue;
    byTitle.set(key, {
      id: s.id,
      title: s.title,
      prayerText: s.prayer_text,
      latinText: s.latin_text,
      category: s.category,
      context: s.context,
      attribution: s.attribution,
      isLocal: true,
      overrideNote: null,
    });
  }
  return [...byTitle.values()].sort((a, b) => a.title.localeCompare(b.title));
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
  await getDb(parishId).query("DELETE FROM prayer_submissions WHERE id = $1 AND parish_id = $2", [id, parishId]);
}

/** Upsert a per-parish override of a universal prayer (text/context). */
export async function upsertPrayerOverride(
  parishId: string,
  entryId: string,
  o: { text?: string | null; context?: string | null; notes?: string | null },
): Promise<void> {
  await getDb(parishId).query(
    `INSERT INTO prayer_overrides (parish_id, entry_id, override_text, override_context, override_notes)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (parish_id, entry_id) DO UPDATE SET
       override_text = EXCLUDED.override_text,
       override_context = EXCLUDED.override_context,
       override_notes = EXCLUDED.override_notes`,
    [parishId, entryId, orNull(o.text), orNull(o.context), orNull(o.notes)],
  );
}
