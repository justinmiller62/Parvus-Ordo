"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { buildDictIndex, type DictIndex } from "@parvaordo/core/dictionary-text";
import { DefinitionModal, type DictTermData } from "./definition-modal";

export type { DictTermData };

interface DictionaryContextValue {
  /** The compiled phrase index (shared by reading + transcript highlighters). */
  index: DictIndex;
  /** Open the definition popover for a (lowercased) headword. */
  open: (headword: string) => void;
  hasTerms: boolean;
}

const DictionaryContext = createContext<DictionaryContextValue | null>(null);

/** Access the lesson's dictionary highlighting; null when no provider is mounted. */
export function useDictionary(): DictionaryContextValue | null {
  return useContext(DictionaryContext);
}

/**
 * Provides the dictionary index + the shared definition popover to a lesson's reading and
 * transcript highlighters. The index is compiled once from the parish's visible terms
 * (built client-side since Set/Map don't cross the RSC boundary); opening a term renders a
 * single accessible modal for the whole subtree.
 */
export function DictionaryProvider({ terms, children }: { terms: DictTermData[]; children: ReactNode }) {
  const index = useMemo(
    () => buildDictIndex(terms.map((t) => ({ headword: t.headword, variants: t.variants }))),
    [terms],
  );
  const byHeadword = useMemo(() => {
    const m = new Map<string, DictTermData>();
    for (const t of terms) m.set(t.headword.toLowerCase(), t);
    return m;
  }, [terms]);
  const [active, setActive] = useState<DictTermData | null>(null);

  const value = useMemo<DictionaryContextValue>(
    () => ({
      index,
      hasTerms: terms.length > 0,
      open: (headword) => {
        const term = byHeadword.get(headword.toLowerCase());
        if (term) setActive(term);
      },
    }),
    [index, byHeadword, terms.length],
  );

  return (
    <DictionaryContext.Provider value={value}>
      {children}
      <DefinitionModal term={active} onClose={() => setActive(null)} />
    </DictionaryContext.Provider>
  );
}
