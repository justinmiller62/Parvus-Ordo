// Pure dictionary text logic (no DOM, no DB) — ported from Narthex lib/dictionary.ts.
// The lesson reader consumes findDictionaryTerms to underline terms; the DOM
// span-wrapping stays in a client component. normalizeSacredText lives in
// @parvaordo/shared (used by both server + client) and is re-exported here.
export { normalizeSacredText } from "@parvaordo/shared";

/** Lowercase + strip leading/trailing punctuation (incl. smart quotes). */
export function normalizeWord(w: string): string {
  return w
    .toLowerCase()
    .replace(/^[\s"'“”‘’.,;:!?()[\]{}]+/, "")
    .replace(/[\s"'“”‘’.,;:!?()[\]{}]+$/, "");
}

export interface DictTermInput {
  headword: string;
  variants?: string[] | null;
}

export interface DictIndex {
  /** normalized first-word → true (a phrase could start here) */
  firstWords: Set<string>;
  /** normalized full phrase → canonical headword */
  phraseMap: Map<string, string>;
  /** phrases sorted longest-first (by word count) for greedy matching */
  phrases: string[];
}

/** Build a phrase index from headwords + variants for greedy longest-first matching. */
export function buildDictIndex(terms: DictTermInput[]): DictIndex {
  const phraseMap = new Map<string, string>();
  const firstWords = new Set<string>();
  for (const t of terms) {
    const headword = t.headword;
    for (const raw of [headword, ...(t.variants ?? [])]) {
      const phrase = raw.split(/\s+/).map(normalizeWord).filter(Boolean).join(" ");
      if (!phrase) continue;
      if (!phraseMap.has(phrase)) phraseMap.set(phrase, headword.toLowerCase());
      firstWords.add(phrase.split(" ")[0]!);
    }
  }
  const phrases = [...phraseMap.keys()].sort((a, b) => b.split(" ").length - a.split(" ").length);
  return { firstWords, phraseMap, phrases };
}

/** Longest matching phrase starting at word index `i`, or null. */
export function matchPhraseAt(
  words: string[],
  i: number,
  index: DictIndex,
): { headword: string; length: number } | null {
  if (!index.firstWords.has(words[i] ?? "")) return null;
  for (const phrase of index.phrases) {
    const parts = phrase.split(" ");
    if (parts[0] !== words[i]) continue;
    if (i + parts.length > words.length) continue;
    let ok = true;
    for (let k = 1; k < parts.length; k++) {
      if (words[i + k] !== parts[k]) {
        ok = false;
        break;
      }
    }
    if (ok) return { headword: index.phraseMap.get(phrase)!, length: parts.length };
  }
  return null;
}

export interface TermMatch {
  headword: string;
  /** word index where the match starts */
  at: number;
  /** number of words spanned */
  length: number;
}

/** First occurrence of each matched headword in `text`, longest-phrase-first
 * (so "Holy Spirit" matches as a phrase, not "Spirit" inside it). */
export function findDictionaryTerms(text: string, index: DictIndex): TermMatch[] {
  const words = text.split(/\s+/).map(normalizeWord);
  const seen = new Set<string>();
  const matches: TermMatch[] = [];
  for (let i = 0; i < words.length; i++) {
    if (!words[i]) continue;
    const m = matchPhraseAt(words, i, index);
    if (m && !seen.has(m.headword)) {
      seen.add(m.headword);
      matches.push({ headword: m.headword, at: i, length: m.length });
      i += m.length - 1; // skip the matched span
    }
  }
  return matches;
}

const PUNCT_LEAD = /^[\s"'“”‘’.,;:!?()[\]{}]+/;
const PUNCT_TRAIL = /[\s"'“”‘’.,;:!?()[\]{}]+$/;

/** A run of `text`; `headword` is set when the run is a matched dictionary term. */
export interface DictSegment {
  text: string;
  headword?: string;
}

/**
 * Split `text` into segments, marking the FIRST occurrence of each dictionary headword
 * (greedy longest phrase). Unlike findDictionaryTerms (word indices), this preserves the
 * ORIGINAL characters exactly — leading/trailing punctuation is kept OUTSIDE the term
 * run so the highlighted span is just the word(s). `seen` is mutated and may be shared
 * across calls (e.g. per text node) for document-level first-occurrence dedup.
 */
export function segmentText(text: string, index: DictIndex, seen: Set<string> = new Set()): DictSegment[] {
  const tokens: { start: number; end: number; norm: string }[] = [];
  const re = /\S+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    tokens.push({ start: m.index, end: m.index + m[0].length, norm: normalizeWord(m[0]) });
  }
  const norm = tokens.map((t) => t.norm);

  const segments: DictSegment[] = [];
  let cursor = 0; // chars emitted so far
  for (let i = 0; i < tokens.length; i++) {
    if (!norm[i]) continue;
    const match = matchPhraseAt(norm, i, index);
    if (!match || seen.has(match.headword)) continue;
    seen.add(match.headword);

    const startChar = tokens[i]!.start;
    const endChar = tokens[i + match.length - 1]!.end;
    const raw = text.slice(startChar, endChar);
    const lead = PUNCT_LEAD.exec(raw)?.[0] ?? "";
    const afterLead = raw.slice(lead.length);
    const trail = PUNCT_TRAIL.exec(afterLead)?.[0] ?? "";
    const core = afterLead.slice(0, afterLead.length - trail.length);
    if (!core) continue;

    const pre = text.slice(cursor, startChar) + lead; // emitted-gap + the term's leading punctuation
    if (pre) segments.push({ text: pre });
    segments.push({ text: core, headword: match.headword });
    if (trail) segments.push({ text: trail });
    cursor = endChar;
    i += match.length - 1;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

const ATTR_ESCAPE: Record<string, string> = { "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" };
function escapeAttr(value: string): string {
  return value.replace(/[&"<>]/g, (c) => ATTR_ESCAPE[c]!);
}

/**
 * Wrap dictionary terms in reading HTML with clickable spans, touching ONLY the text
 * between tags — tags and attributes are passed through verbatim, so the markup can never
 * be corrupted (no DOM, fully testable). Each term becomes
 * `<span class="dict-term" role="button" tabindex="0" data-dict-term="<headword>">…</span>`;
 * the client wires a single delegated click/Enter handler. First occurrence of each
 * headword across the whole document (the split text runs share one `seen` set).
 */
export function highlightHtml(html: string, index: DictIndex): string {
  const parts = html.split(/(<[^>]*>)/);
  const seen = new Set<string>();
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (i % 2 === 1 || !part) {
      out += part; // a tag (odd index) or empty run — passthrough
      continue;
    }
    for (const seg of segmentText(part, index, seen)) {
      out += seg.headword
        ? `<span class="dict-term" role="button" tabindex="0" data-dict-term="${escapeAttr(seg.headword)}">${seg.text}</span>`
        : seg.text;
    }
  }
  return out;
}
