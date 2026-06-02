import { orNull, trimOrEmpty } from "@parvaordo/shared";
import { getDb, type TenantDb } from "../db/client";

// Dictionary data access. Three layers: global dictionary_entries (universal,
// approved), per-parish dictionary_overrides (wide-column field overrides), and
// per-parish dictionary_submissions (pending new terms). listDictionary merges
// them (universal wins by lowercased headword) with overrides applied.

export interface DictionaryItem {
  id: string;
  headword: string;
  variants: string[] | null;
  pronunciation: string | null;
  definition: string;
  greekWord: string | null;
  greekDefinition: string | null;
  hebrewWord: string | null;
  hebrewDefinition: string | null;
  firstCenturyContext: string | null;
  catechismReferences: string[] | null;
  scriptureReferences: string[] | null;
  category: string | null;
  /** true = a parish submission (badged "Parish"), not a universal entry */
  isLocal: boolean;
  /** parish override note, if this entry has one applied */
  overrideNote: string | null;
}

export interface NewSubmissionInput {
  headword: string;
  variants?: string[] | null;
  definition: string;
  greekWord?: string | null;
  greekDefinition?: string | null;
  hebrewWord?: string | null;
  hebrewDefinition?: string | null;
  firstCenturyContext?: string | null;
}

interface EntryRow {
  id: string;
  headword: string;
  variants: string[] | null;
  pronunciation: string | null;
  definition: string;
  greek_word: string | null;
  greek_definition: string | null;
  hebrew_word: string | null;
  hebrew_definition: string | null;
  first_century_context: string | null;
  catechism_references: string[] | null;
  scripture_references: string[] | null;
  category: string | null;
}

// The approved universal glossary (dictionary_entries) has no parish_id and its RLS
// policy exposes every approved row to every tenant (0019_dictionary.sql), so the same
// bytes are re-read and re-sorted per request for each parish. It changes only via
// owner/seed/MCP writes (no in-app path), so we cache the set process-locally and let
// per-parish overrides/submissions layer on top each request. This holds only public
// global data — never per-parish state — so it's rebuildable, not authoritative tenant
// state (stays within the statelessness rules). Writers call invalidateDictionaryCache();
// the TTL is the backstop for those out-of-process writes.
/** Backstop TTL for the cached global glossary, in ms. Out-of-process owner/seed/MCP
 * writes that forget to invalidate still surface within this window. */
export const DICTIONARY_CACHE_TTL_MS = 5 * 60 * 1000;

let universalCache: { rows: EntryRow[]; expiresAt: number } | null = null;

/** Drop the cached global glossary so the next listDictionary re-reads it. Call from the
 * owner/seed/MCP path after writing dictionary_entries. */
export function invalidateDictionaryCache(): void {
  universalCache = null;
}

/** The approved universal entries, from the process-local cache when warm. The data is
 * identical for every tenant, so any tenant connection fetches the same global set; a
 * brief cold-start stampede across concurrent requests is acceptable for this low-churn
 * reference data. */
async function getUniversalEntries(db: TenantDb, nowMs: number): Promise<EntryRow[]> {
  if (universalCache && nowMs < universalCache.expiresAt) return universalCache.rows;
  const { rows } = await db.query<EntryRow>(
    `SELECT id, headword, variants, pronunciation, definition, greek_word, greek_definition,
            hebrew_word, hebrew_definition, first_century_context, catechism_references,
            scripture_references, category
       FROM dictionary_entries WHERE status = 'approved' ORDER BY headword`,
  );
  universalCache = { rows, expiresAt: nowMs + DICTIONARY_CACHE_TTL_MS };
  return rows;
}

/** The full glossary a parish sees: approved universal entries (with this parish's
 * overrides applied) + the parish's pending submissions (deduped; universal wins). */
export async function listDictionary(parishId: string, nowMs: number = Date.now()): Promise<DictionaryItem[]> {
  const db = getDb(parishId);
  // Universal set comes from the shared cache (warm: no query); the two per-parish reads
  // run fresh, in parallel with a cold-cache universal fetch.
  const [universal, { rows: overrides }, { rows: submissions }] = await Promise.all([
    getUniversalEntries(db, nowMs),
    db.query<{
      entry_id: string;
      override_definition: string | null;
      override_greek_definition: string | null;
      override_hebrew_definition: string | null;
      override_first_century_context: string | null;
      override_notes: string | null;
    }>(
      `SELECT entry_id, override_definition, override_greek_definition, override_hebrew_definition,
              override_first_century_context, override_notes FROM dictionary_overrides`,
    ),
    db.query<{
      id: string;
      headword: string;
      variants: string[] | null;
      definition: string;
      greek_word: string | null;
      greek_definition: string | null;
      hebrew_word: string | null;
      hebrew_definition: string | null;
      first_century_context: string | null;
    }>(
      `SELECT id, headword, variants, definition, greek_word, greek_definition, hebrew_word,
              hebrew_definition, first_century_context
         FROM dictionary_submissions WHERE status = 'pending' ORDER BY headword`,
    ),
  ]);

  const ovByEntry = new Map(overrides.map((o) => [o.entry_id, o]));
  const byHeadword = new Map<string, DictionaryItem>();

  for (const e of universal) {
    const o = ovByEntry.get(e.id);
    byHeadword.set(e.headword.toLowerCase(), {
      id: e.id,
      headword: e.headword,
      variants: e.variants,
      pronunciation: e.pronunciation,
      definition: o?.override_definition ?? e.definition,
      greekWord: e.greek_word,
      greekDefinition: o?.override_greek_definition ?? e.greek_definition,
      hebrewWord: e.hebrew_word,
      hebrewDefinition: o?.override_hebrew_definition ?? e.hebrew_definition,
      firstCenturyContext: o?.override_first_century_context ?? e.first_century_context,
      catechismReferences: e.catechism_references,
      scriptureReferences: e.scripture_references,
      category: e.category,
      isLocal: false,
      overrideNote: o?.override_notes ?? null,
    });
  }

  // Parish submissions: added only if no universal entry has that headword.
  for (const s of submissions) {
    const key = s.headword.toLowerCase();
    if (byHeadword.has(key)) continue;
    byHeadword.set(key, {
      id: s.id,
      headword: s.headword,
      variants: s.variants,
      pronunciation: null,
      definition: s.definition,
      greekWord: s.greek_word,
      greekDefinition: s.greek_definition,
      hebrewWord: s.hebrew_word,
      hebrewDefinition: s.hebrew_definition,
      firstCenturyContext: s.first_century_context,
      catechismReferences: null,
      scriptureReferences: null,
      category: null,
      isLocal: true,
      overrideNote: null,
    });
  }

  return [...byHeadword.values()].sort((a, b) => a.headword.localeCompare(b.headword));
}

const cleanVariants = (v?: string[] | null) => {
  const out = (v ?? []).map((s) => s.trim()).filter(Boolean);
  return out.length ? out : null;
};

/** Create a parish submission (pending). Returns null if headword/definition empty. */
export async function createSubmission(
  parishId: string,
  submittedBy: string,
  input: NewSubmissionInput,
): Promise<{ id: string } | null> {
  const headword = trimOrEmpty(input.headword).toLowerCase();
  const definition = trimOrEmpty(input.definition);
  if (!headword || !definition) return null;
  const { rows } = await getDb(parishId).query<{ id: string }>(
    `INSERT INTO dictionary_submissions
       (parish_id, headword, variants, definition, greek_word, greek_definition, hebrew_word,
        hebrew_definition, first_century_context, submitted_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      parishId,
      headword,
      cleanVariants(input.variants),
      definition,
      orNull(input.greekWord),
      orNull(input.greekDefinition),
      orNull(input.hebrewWord),
      orNull(input.hebrewDefinition),
      orNull(input.firstCenturyContext),
      submittedBy,
    ],
  );
  return { id: rows[0]!.id };
}

/** Edit a parish submission in place. */
export async function updateSubmission(
  parishId: string,
  submissionId: string,
  input: NewSubmissionInput,
): Promise<void> {
  await getDb(parishId).query(
    `UPDATE dictionary_submissions SET headword=$3, variants=$4, definition=$5, greek_word=$6,
        greek_definition=$7, hebrew_word=$8, hebrew_definition=$9, first_century_context=$10
      WHERE id=$1 AND parish_id=$2`,
    [
      submissionId,
      parishId,
      trimOrEmpty(input.headword).toLowerCase(),
      cleanVariants(input.variants),
      trimOrEmpty(input.definition),
      orNull(input.greekWord),
      orNull(input.greekDefinition),
      orNull(input.hebrewWord),
      orNull(input.hebrewDefinition),
      orNull(input.firstCenturyContext),
    ],
  );
}

export async function deleteSubmission(parishId: string, submissionId: string): Promise<void> {
  await getDb(parishId).query("DELETE FROM dictionary_submissions WHERE id = $1 AND parish_id = $2", [
    submissionId,
    parishId,
  ]);
}

export interface OverrideInput {
  definition?: string | null;
  greekDefinition?: string | null;
  hebrewDefinition?: string | null;
  firstCenturyContext?: string | null;
  notes?: string | null;
}

/** Upsert a per-parish override of a universal entry (only changed fields; rest null). */
export async function upsertOverride(parishId: string, entryId: string, o: OverrideInput): Promise<void> {
  await getDb(parishId).query(
    `INSERT INTO dictionary_overrides
       (parish_id, entry_id, override_definition, override_greek_definition,
        override_hebrew_definition, override_first_century_context, override_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (parish_id, entry_id) DO UPDATE SET
       override_definition = EXCLUDED.override_definition,
       override_greek_definition = EXCLUDED.override_greek_definition,
       override_hebrew_definition = EXCLUDED.override_hebrew_definition,
       override_first_century_context = EXCLUDED.override_first_century_context,
       override_notes = EXCLUDED.override_notes`,
    [
      parishId,
      entryId,
      orNull(o.definition),
      orNull(o.greekDefinition),
      orNull(o.hebrewDefinition),
      orNull(o.firstCenturyContext),
      orNull(o.notes),
    ],
  );
}
