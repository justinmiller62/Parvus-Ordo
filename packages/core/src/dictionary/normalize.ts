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
export function matchPhraseAt(words: string[], i: number, index: DictIndex): { headword: string; length: number } | null {
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
