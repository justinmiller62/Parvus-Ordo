"use client";

import { useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Search, X } from "lucide-react";
import { apologeticsCitationText, matchesApologeticsQuery } from "@parvaordo/shared";

// Shapes mirror core ApologeticsTopic/ApologeticsCitation (kept local to avoid importing
// core into the client bundle — same convention as dictionary-client).
export interface ApologeticsCitationView {
  id: string;
  ref: string;
  sourceKind: string | null;
  altRef: string | null;
  quote: string | null;
  why: string | null;
}

export interface ApologeticsTopicView {
  id: string;
  slug: string;
  label: string;
  objection: string;
  reply: string | null;
  lead: string | null;
  ask: string | null;
  citations: ApologeticsCitationView[];
  overrideNote: string | null;
}

/**
 * DESIGNED MOBILE-FIRST. This page is used one-handed, mid-conversation, so the phone
 * layout is the real layout and the desktop rules are the afterthought:
 *   - one column at every width; `sm:` only widens type and gutters
 *   - every control is a >=44px tap target
 *   - the search + topic chips stay pinned under the shell header while you scroll
 *   - topics are collapsed by default, so the whole corpus is scannable in one thumb-swipe
 *   - long refs/quotes wrap (`break-words`, `min-w-0`) so the body never scrolls sideways
 */
export function ApologeticsClient({ topics }: { topics: ApologeticsTopicView[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const visible = useMemo(() => topics.filter((t) => matchesApologeticsQuery(t, query)), [topics, query]);
  const searching = query.trim().length > 0;

  const toggle = (slug: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  // Transient "Copied" confirmation, keyed so only the pressed button confirms.
  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return; // clipboard denied (insecure context / permission) — leave the label alone
    }
    setCopied(key);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1500);
  }

  const copyButton = (key: string, text: string, label: string) => (
    <button
      type="button"
      onClick={() => copy(key, text)}
      // Small pill, but a 44px touch target via padding on the flex row it sits in.
      className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium tracking-wide text-navy/70 transition-colors hover:bg-navy/5 hover:text-burgundy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy"
      aria-label={label}
    >
      {copied === key ? (
        <>
          <Check className="size-4 text-burgundy" aria-hidden />
          <span className="text-burgundy">Copied</span>
        </>
      ) : (
        <>
          <Copy className="size-4" aria-hidden />
          <span>Copy</span>
        </>
      )}
    </button>
  );

  return (
    // No max-w cap below sm: the phone gets the full gutter-to-gutter width.
    <div className="mx-auto w-full max-w-2xl">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-navy/40">Reference</p>
        <h1 className="font-heading text-2xl leading-tight text-navy sm:text-3xl">Apologetics</h1>
        <p className="text-sm text-navy/60">Scripture and the early Church, one objection at a time.</p>
        <p className="pt-1 text-xs leading-relaxed text-navy/50">
          Quotations are Douay-Rheims. References use the numbering in most modern Bibles;{" "}
          <span className="font-medium text-burgundy">DR</span> marks the Douay-Rheims number where it differs.
        </p>
      </header>

      {/* Sticky tool rail: search + chips. `top-0` pins it under the app shell's own header. */}
      <div className="sticky top-0 z-10 -mx-4 mt-4 border-b border-navy/10 bg-parchment/95 px-4 pb-2 pt-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-navy/40"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search verses, words, objections…"
            aria-label="Search the apologetics corpus"
            autoComplete="off"
            // text-base (16px) — anything smaller makes iOS Safari zoom on focus.
            className="min-h-[44px] w-full rounded-lg border border-navy/15 bg-white pl-9 pr-10 text-base text-navy placeholder:text-navy/40 focus-visible:border-burgundy focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-burgundy"
          />
          {searching && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-0 top-0 grid size-11 place-items-center text-navy/40 hover:text-burgundy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>

        {/* Horizontally scrollable chips — the mobile substitute for a sidebar. */}
        <nav
          aria-label="Jump to topic"
          className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden"
        >
          {topics.map((t) => (
            <a
              key={t.slug}
              href={`#${t.slug}`}
              onClick={() => setOpen((prev) => new Set(prev).add(t.slug))}
              className="inline-flex min-h-[44px] shrink-0 items-center rounded-full bg-navy/[0.07] px-3.5 text-xs font-medium tracking-wide whitespace-nowrap text-navy/70 transition-colors hover:bg-burgundy/10 hover:text-burgundy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy"
            >
              {t.label}
            </a>
          ))}
        </nav>
      </div>

      {visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-navy/50">Nothing matches “{query.trim()}”.</p>
      ) : (
        <ul className="divide-y divide-navy/10">
          {visible.map((topic) => {
            // While searching, show everything expanded — hiding the matched verse behind a
            // tap would defeat the search.
            const isOpen = searching || open.has(topic.slug);
            const bodyId = `${topic.slug}-body`;
            const allText = [
              topic.objection,
              topic.reply ?? topic.lead,
              ...topic.citations.map((c) => apologeticsCitationText(c)),
            ]
              .filter(Boolean)
              .join("\n\n");

            return (
              <li key={topic.id} id={topic.slug} className="scroll-mt-32 py-4">
                {/* Head row: objection + lead stay visible; the chevron folds the rest. */}
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => toggle(topic.slug)}
                    aria-expanded={isOpen}
                    aria-controls={bodyId}
                    // The whole head is the tap target, not just the chevron.
                    className="-my-1 flex min-w-0 flex-1 items-start gap-1 rounded-lg py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy"
                  >
                    <span className="min-w-0 flex-1">
                      {/* Body font, not `font-heading`: the brand heading face (Cinzel) is
                          all-caps, which is unreadable for a full-sentence objection on a
                          phone. Italic + medium carries the "someone said this" voice. */}
                      <span className="block text-lg font-medium italic leading-snug text-navy break-words sm:text-xl">
                        {topic.objection}
                      </span>
                      {topic.reply && (
                        <span className="mt-1 block text-sm leading-relaxed text-navy/75 break-words">
                          {topic.reply}
                        </span>
                      )}
                      {topic.lead && (
                        <span className="mt-1 block text-sm leading-relaxed text-navy/75 break-words">
                          {topic.lead}
                        </span>
                      )}
                    </span>
                    <ChevronDown
                      aria-hidden
                      className={`mt-1 size-5 shrink-0 text-burgundy transition-transform ${isOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                </div>

                {/* The "ask" prompt stays visible collapsed — it's the thing you actually say. */}
                {topic.ask && (
                  <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg bg-cream/60 px-3 py-2 text-sm leading-relaxed text-navy/80">
                    <span className="text-xs font-semibold uppercase tracking-wider text-burgundy">Ask</span>
                    <span className="min-w-0 flex-1 break-words">{topic.ask}</span>
                  </p>
                )}

                {isOpen && (
                  <div id={bodyId} className="mt-4 space-y-4">
                    {topic.citations.map((c) => (
                      <div key={c.id} className="space-y-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-sm font-semibold tracking-wide text-burgundy break-words">{c.ref}</span>
                          {c.altRef && <span className="text-xs text-navy/50">{c.altRef}</span>}
                          {c.sourceKind && (
                            <span className="text-[0.7rem] uppercase tracking-wider text-navy/45">{c.sourceKind}</span>
                          )}
                        </div>
                        {/* Also NOT `font-heading` (all-caps Cinzel would mangle scripture).
                            A burgundy rule sets the quotation apart instead of a face change. */}
                        {c.quote && (
                          <blockquote className="border-l-2 border-burgundy/30 pl-3 text-base leading-relaxed text-navy break-words">
                            {c.quote}
                          </blockquote>
                        )}
                        {c.why && <p className="text-sm leading-relaxed text-navy/60 break-words">{c.why}</p>}
                        <div className="flex">{copyButton(c.id, apologeticsCitationText(c), `Copy ${c.ref}`)}</div>
                      </div>
                    ))}

                    {topic.overrideNote && (
                      <p className="rounded-lg bg-navy/[0.04] px-3 py-2 text-xs leading-relaxed text-navy/60">
                        <span className="font-semibold uppercase tracking-wider text-navy/50">Parish note</span>{" "}
                        {topic.overrideNote}
                      </p>
                    )}

                    <div className="flex">{copyButton(`all-${topic.id}`, allText, `Copy all of ${topic.label}`)}</div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <footer className="mt-8 space-y-2 border-t border-navy/10 pt-4 text-xs leading-relaxed text-navy/50">
        <p>
          Every quotation was checked against the Douay-Rheims (Challoner), the Catechism, and the texts of the Fathers
          and Councils in the Parvus Ordo Catholic Corpus. Ignatius, Justin, and Cyprian are translated from the Latin
          in Migne.
        </p>
        <p>Check the wording in the other person’s own Bible before quoting, since translations differ.</p>
      </footer>
    </div>
  );
}
