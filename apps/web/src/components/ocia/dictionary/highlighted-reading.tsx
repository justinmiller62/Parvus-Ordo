"use client";

import { useMemo, type KeyboardEvent, type MouseEvent } from "react";
import { highlightHtml } from "@parvaordo/core/dictionary-text";
import { useDictionary } from "./dictionary-provider";

// Dictionary-term styling for the spans highlightHtml injects into the reading HTML.
// Scoped to this container via arbitrary variants so no global CSS is needed.
const TERM_STYLE =
  "[&_.dict-term]:cursor-pointer [&_.dict-term]:rounded-sm [&_.dict-term]:font-medium [&_.dict-term]:text-burgundy " +
  "[&_.dict-term]:underline [&_.dict-term]:decoration-dotted [&_.dict-term]:decoration-gold [&_.dict-term]:underline-offset-2 " +
  "hover:[&_.dict-term]:bg-cream/50 [&_.dict-term:focus-visible]:outline [&_.dict-term:focus-visible]:outline-2 [&_.dict-term:focus-visible]:outline-gold";

/**
 * Render reading HTML with dictionary terms underlined and clickable. The match +
 * span-injection is the pure `highlightHtml` (memoized per html/index); a single delegated
 * click/Enter handler opens the definition popover, so per-term listeners aren't needed.
 * With no provider (or no terms) it renders the original HTML unchanged.
 */
export function HighlightedReading({ html, className }: { html: string; className?: string }) {
  const dict = useDictionary();
  const rendered = useMemo(() => (dict ? highlightHtml(html, dict.index) : html), [html, dict]);

  const openFromEvent = (target: EventTarget | null) => {
    const el = (target as HTMLElement | null)?.closest<HTMLElement>(".dict-term");
    const headword = el?.dataset.dictTerm;
    if (headword) dict?.open(headword);
    return Boolean(headword);
  };

  const onClick = (e: MouseEvent) => {
    if (openFromEvent(e.target)) e.preventDefault();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (openFromEvent(e.target)) e.preventDefault();
  };

  return (
    <div
      className={`${className ?? ""} ${TERM_STYLE}`}
      onClick={onClick}
      onKeyDown={onKeyDown}
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  );
}
