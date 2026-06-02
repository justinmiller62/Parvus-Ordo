"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Pencil, Plus, Rss } from "lucide-react";
import { normalizeSacredText } from "@parvaordo/shared";
import type { CalendarSource } from "@parvaordo/core/calendar-types";
import { SourceModal } from "./source-modal";
import { setSourceEnabledAction } from "./sources-actions";

type ModalState = { mode: "create" } | { mode: "edit"; source: CalendarSource } | null;

/** Editor-only management of external iCal feeds. The list renders from server props; every
 *  mutation runs a Server Action that revalidates this route + the calendar, so the list
 *  reflects the new state on the next render. Feed names are sacred-text-normalized to match
 *  how they render in the calendar grid. */
export function SourcesClient({ sources }: { sources: CalendarSource[] }) {
  const [modal, setModal] = useState<ModalState>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(source: CalendarSource) {
    setTogglingId(source.id);
    startTransition(async () => {
      await setSourceEnabledAction(source.id, !source.enabled);
      setTogglingId(null);
    });
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Link
        href="/ocia/calendar"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-navy"
      >
        <ArrowLeft className="h-4 w-4" /> Back to calendar
      </Link>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl text-navy">Calendar feeds</h1>
          <p className="mt-1 text-sm text-gray-500">
            External iCal feeds layered onto the parish calendar. Feeds are fetched live and never stored; only enabled
            feeds are visible to the parish.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ mode: "create" })}
          data-testid="add-source"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gold-dark"
        >
          <Plus className="h-4 w-4" /> Add feed
        </button>
      </div>

      {sources.length === 0 ? (
        <div
          data-testid="sources-empty"
          className="mt-8 rounded-2xl border border-dashed border-gray-300 bg-parchment/40 p-10 text-center"
        >
          <Rss className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 font-medium text-navy">No feeds yet</p>
          <p className="mt-1 text-sm text-gray-500">
            Add a diocesan or community iCal feed to layer its events onto the calendar.
          </p>
        </div>
      ) : (
        <ul data-testid="sources-list" className="mt-6 space-y-2">
          {sources.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 transition-shadow hover:shadow-sm"
            >
              <span aria-hidden className="h-8 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <div className="min-w-0 flex-1">
                <p className={`truncate font-medium ${s.enabled ? "text-navy" : "text-gray-400"}`}>
                  {normalizeSacredText(s.name)}
                </p>
                <p className="truncate text-xs text-gray-400">{s.url}</p>
              </div>
              <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-gray-500">
                <span className="hidden sm:inline">{s.enabled ? "Enabled" : "Disabled"}</span>
                <input
                  type="checkbox"
                  checked={s.enabled}
                  disabled={pending && togglingId === s.id}
                  onChange={() => toggle(s)}
                  aria-label={`${s.enabled ? "Disable" : "Enable"} ${s.name}`}
                  data-testid="source-toggle"
                  className="h-4 w-4 accent-gold disabled:opacity-40"
                />
              </label>
              <button
                type="button"
                onClick={() => setModal({ mode: "edit", source: s })}
                aria-label={`Edit ${s.name}`}
                data-testid="source-edit"
                className="shrink-0 rounded-md p-2 text-gray-400 transition-colors hover:bg-parchment hover:text-navy"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {modal ? (
        <SourceModal
          mode={modal.mode}
          source={modal.mode === "edit" ? modal.source : undefined}
          onClose={() => setModal(null)}
        />
      ) : null}
    </div>
  );
}
