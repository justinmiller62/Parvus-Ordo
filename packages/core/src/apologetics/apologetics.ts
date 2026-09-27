import { getDb, type TenantDb } from "../db/client";

// Apologetics data access. Three layers, mirroring the dictionary (0019) and prayers (0020):
// GLOBAL apologetics_topics + apologetics_citations (universal, approved) and per-parish
// apologetics_overrides. v1 is READ-ONLY — the overrides table ships with the migration but
// has no write path yet, so listApologetics applies any override rows it finds and nothing
// in-app creates them.

/** A citation under a topic: Scripture, a Father, a Council, or the Catechism. */
export interface ApologeticsCitation {
  id: string;
  /** Source label as displayed ("John 6:53", "St. Cyprian, On the Unity of the Church 6"). */
  ref: string;
  /** Provenance badge ("Father · c. 251"). null = Scripture, which needs no badge. */
  sourceKind: string | null;
  /** Douay-Rheims numbering where it differs from most modern Bibles ("DR 6:54"). */
  altRef: string | null;
  /** null for whole-chapter pointers (e.g. "Hebrews 11") that carry only a `why`. */
  quote: string | null;
  /** Short gloss on why this citation answers the objection. */
  why: string | null;
}

export interface ApologeticsTopic {
  id: string;
  /** Stable anchor slug; also the deep-link fragment. */
  slug: string;
  /** Short nav label ("John 6"), distinct from the full objection text. */
  label: string;
  objection: string;
  /** null where the topic opens with `lead` instead (the summary card). */
  reply: string | null;
  lead: string | null;
  ask: string | null;
  citations: ApologeticsCitation[];
  /** parish override note, if this topic has one applied */
  overrideNote: string | null;
}

interface TopicRow {
  id: string;
  slug: string;
  label: string;
  objection: string;
  reply: string | null;
  lead: string | null;
  ask: string | null;
}

interface CitationRow {
  id: string;
  topic_id: string;
  ref: string;
  source_kind: string | null;
  alt_ref: string | null;
  quote: string | null;
  why: string | null;
}

interface OverrideRow {
  topic_id: string;
  override_reply: string | null;
  override_ask: string | null;
  override_notes: string | null;
}

// The approved global corpus has no parish_id and its RLS policies expose every approved row
// to every tenant (0033_apologetics.sql), so the same bytes would be re-read and re-sorted per
// request for each parish. It changes only via owner/seed writes (no in-app path), so we cache
// it process-locally and layer per-parish overrides on top each request — the same trade the
// dictionary makes. This holds only public global data, never per-parish state, so it stays
// rebuildable rather than authoritative tenant state (within the statelessness rules).
/** Backstop TTL for the cached global corpus, in ms. Out-of-process owner/seed writes that
 * forget to invalidate still surface within this window. */
export const APOLOGETICS_CACHE_TTL_MS = 5 * 60 * 1000;

let corpusCache: { topics: TopicRow[]; citations: CitationRow[]; expiresAt: number } | null = null;

/** Drop the cached global corpus so the next listApologetics re-reads it. Call from the
 * owner/seed path after writing apologetics_topics / apologetics_citations. */
export function invalidateApologeticsCache(): void {
  corpusCache = null;
}

/** The approved global corpus, from the process-local cache when warm. Identical for every
 * tenant, so any tenant connection fetches the same global set. */
async function getCorpus(db: TenantDb, nowMs: number): Promise<{ topics: TopicRow[]; citations: CitationRow[] }> {
  if (corpusCache && nowMs < corpusCache.expiresAt) return corpusCache;
  const [{ rows: topics }, { rows: citations }] = await Promise.all([
    db.query<TopicRow>(
      `SELECT id, slug, label, objection, reply, lead, ask
         FROM apologetics_topics WHERE status = 'approved' ORDER BY display_order, slug`,
    ),
    db.query<CitationRow>(
      `SELECT c.id, c.topic_id, c.ref, c.source_kind, c.alt_ref, c.quote, c.why
         FROM apologetics_citations c
         JOIN apologetics_topics t ON t.id = c.topic_id
        WHERE t.status = 'approved'
        ORDER BY c.topic_id, c.display_order`,
    ),
  ]);
  corpusCache = { topics, citations, expiresAt: nowMs + APOLOGETICS_CACHE_TTL_MS };
  return corpusCache;
}

/**
 * The apologetics corpus a parish sees: approved global topics in display order, each with
 * its citations, with this parish's overrides applied. Read-only in v1.
 */
export async function listApologetics(parishId: string, nowMs: number = Date.now()): Promise<ApologeticsTopic[]> {
  const db = getDb(parishId);
  // Global corpus comes from the shared cache (warm: no query); the per-parish override read
  // runs fresh, in parallel with a cold-cache corpus fetch.
  const [corpus, { rows: overrides }] = await Promise.all([
    getCorpus(db, nowMs),
    db.query<OverrideRow>(`SELECT topic_id, override_reply, override_ask, override_notes FROM apologetics_overrides`),
  ]);

  const byTopic = new Map<string, ApologeticsCitation[]>();
  for (const c of corpus.citations) {
    const list = byTopic.get(c.topic_id) ?? [];
    list.push({ id: c.id, ref: c.ref, sourceKind: c.source_kind, altRef: c.alt_ref, quote: c.quote, why: c.why });
    byTopic.set(c.topic_id, list);
  }
  const overrideBy = new Map(overrides.map((o) => [o.topic_id, o]));

  return corpus.topics.map((t) => {
    const o = overrideBy.get(t.id);
    return {
      id: t.id,
      slug: t.slug,
      label: t.label,
      objection: t.objection,
      reply: o?.override_reply ?? t.reply,
      lead: t.lead,
      ask: o?.override_ask ?? t.ask,
      citations: byTopic.get(t.id) ?? [],
      overrideNote: o?.override_notes ?? null,
    };
  });
}
