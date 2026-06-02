"use client";

import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { BookOpen, X } from "lucide-react";

export interface DictTermData {
  headword: string;
  variants: string[] | null;
  definition: string;
  pronunciation: string | null;
  category: string | null;
  /** A parish submission (badged "Parish"), not a universal entry. */
  isLocal: boolean;
}

const FOCUSABLE = 'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * An accessible definition popover for a dictionary term, opened in place over the lesson.
 * Focus is trapped while open, Escape and a backdrop click close it, focus returns to the
 * element that opened it, and the entrance animation is gated on `prefers-reduced-motion`.
 */
export function DefinitionModal({ term, onClose }: { term: DictTermData | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Remember the trigger so focus can return to it on close.
  useEffect(() => {
    if (term) restoreFocusRef.current = document.activeElement as HTMLElement | null;
  }, [term]);

  const close = useCallback(() => {
    onClose();
    restoreFocusRef.current?.focus?.();
  }, [onClose]);

  useEffect(() => {
    if (!term) return;
    const dialog = dialogRef.current;
    // Move focus into the dialog (close button) once it mounts.
    dialog?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      // Focus trap: keep Tab/Shift+Tab cycling within the dialog.
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // lock background scroll
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [term, close]);

  if (term === null || typeof document === "undefined") return null;

  const titleId = "dict-term-title";
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy/30 p-4 backdrop-blur-sm sm:items-center motion-safe:animate-[po-fade-in_160ms_ease-out]"
      onClick={close}
      data-testid="dictionary-modal-backdrop"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="dictionary-modal"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl motion-safe:animate-[po-slide-up_220ms_ease-out]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="font-heading text-xl capitalize text-navy">
              {term.headword}
            </h2>
            {term.pronunciation ? <p className="mt-0.5 text-sm italic text-gray-400">{term.pronunciation}</p> : null}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close definition"
            data-testid="dictionary-modal-close"
            className="-mr-1 -mt-1 shrink-0 rounded-md p-1.5 text-gray-400 transition hover:bg-parchment hover:text-navy"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-1 flex flex-wrap gap-1.5">
          {term.category ? (
            <span className="rounded-full bg-parchment px-2 py-0.5 text-xs font-medium capitalize text-gray-600">
              {term.category}
            </span>
          ) : null}
          {term.isLocal ? (
            <span className="rounded-full bg-cream/40 px-2 py-0.5 text-xs font-medium text-gold-dark">Parish</span>
          ) : null}
        </div>

        <p className="mt-3 text-sm leading-relaxed text-gray-700">{term.definition}</p>

        <div className="mt-5 flex justify-end">
          <Link
            href={`/dictionary?q=${encodeURIComponent(term.headword)}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-burgundy transition hover:text-rose"
          >
            <BookOpen className="h-4 w-4" />
            Open in dictionary
          </Link>
        </div>
      </div>
    </div>,
    document.body,
  );
}
