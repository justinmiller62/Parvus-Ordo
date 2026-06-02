"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Trash2, X } from "lucide-react";
import type { CalendarSource } from "@parvaordo/core/calendar-types";
import { createSourceAction, deleteSourceAction, updateSourceAction } from "./sources-actions";

const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';
const FIELD =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";
const LABEL = "block text-xs font-medium text-gray-600";
const DEFAULT_COLOR = "#3b82f6"; // matches core's validate() fallback
const HEX = /^#[0-9a-f]{6}$/i;

export interface SourceModalProps {
  mode: "create" | "edit";
  /** Pre-fills the form when editing an existing feed. */
  source?: CalendarSource;
  onClose: () => void;
}

/** Add / edit an external iCal feed (calendar_sources). Submit is blocked unless a name and
 *  an https:// URL are present (core re-validates the shape server-side). Delete is offered
 *  in edit mode behind a confirm — Narthex had none. */
export function SourceModal({ mode, source, onClose }: SourceModalProps) {
  const [name, setName] = useState(source?.name ?? "");
  const [url, setUrl] = useState(source?.url ?? "");
  const [color, setColor] = useState(source?.color ?? DEFAULT_COLOR);
  const [enabled, setEnabled] = useState(source?.enabled ?? true);
  const [pending, startTransition] = useTransition();

  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "Tab" && dialogRef.current) {
        const f = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (f.length === 0) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  function close() {
    onClose();
    restoreRef.current?.focus?.();
  }

  const validColor = HEX.test(color) ? color : DEFAULT_COLOR;
  const canSubmit = name.trim().length > 0 && /^https:\/\//i.test(url.trim()) && !pending;

  function save() {
    if (!canSubmit) return;
    const input = { name: name.trim(), url: url.trim(), color: validColor, enabled };
    startTransition(async () => {
      if (mode === "edit" && source) await updateSourceAction(source.id, input);
      else await createSourceAction(input);
      close();
    });
  }

  function remove() {
    if (!source || pending) return;
    if (!confirm(`Delete the feed "${source.name}"? This can't be undone.`)) return;
    startTransition(async () => {
      await deleteSourceAction(source.id);
      close();
    });
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy/30 p-4 backdrop-blur-sm sm:items-center motion-safe:animate-[po-fade-in_160ms_ease-out]"
      onClick={close}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={mode === "edit" ? "Edit feed" : "Add feed"}
        data-testid="source-modal"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md overflow-auto rounded-2xl bg-white p-6 shadow-xl motion-safe:animate-[po-slide-up_220ms_ease-out]"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-xl text-navy">{mode === "edit" ? "Edit feed" : "Add feed"}</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded-md p-1.5 text-gray-400 hover:bg-parchment hover:text-navy"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className={LABEL}>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
              placeholder="Diocesan Liturgical Calendar"
              data-testid="source-name"
              className={`mt-1 ${FIELD}`}
            />
          </label>
          <label className={LABEL}>
            iCal URL
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              inputMode="url"
              placeholder="https://example.org/calendar.ics"
              data-testid="source-url"
              className={`mt-1 ${FIELD}`}
            />
            <span className="mt-1 block text-[11px] text-gray-400">
              Must be an https:// link to a public .ics feed. Feeds are fetched live, never stored.
            </span>
          </label>
          <label className={LABEL}>
            Color
            <span className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={validColor}
                onChange={(e) => setColor(e.target.value)}
                aria-label="Feed color"
                data-testid="source-color"
                className="h-9 w-12 cursor-pointer rounded-md border border-gray-300 bg-white p-0.5"
              />
              <span className="text-xs text-gray-500">Shown on this feed's events in the calendar.</span>
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              data-testid="source-enabled"
              className="accent-gold"
            />
            Enabled (visible to everyone in the parish)
          </label>

          <div className="flex items-center justify-between border-t border-gray-200 pt-4">
            {mode === "edit" ? (
              <button
                type="button"
                onClick={remove}
                disabled={pending}
                data-testid="source-delete"
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-rose hover:bg-rose/10 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={!canSubmit}
              data-testid="source-save"
              className="rounded-md bg-gold px-5 py-2 text-sm font-medium text-white hover:bg-gold-dark disabled:opacity-50"
            >
              {pending ? "Saving…" : mode === "edit" ? "Save" : "Add feed"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
