"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { normalizeSacredText } from "@parvaordo/shared";
import {
  type CalendarEvent,
  COHORT_SOURCE_LABEL,
  type CalendarSource,
  type MergedEvent,
  NARTHEX_SOURCE_LABEL,
} from "@parvaordo/core/calendar-types";
import { CalendarEventModal } from "./calendar-event-modal";

const MONTHS = "January February March April May June July August September October November December".split(" ");
const MONTHS_SHORT = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_MS = 86_400_000;

function parseMonth(month: string): [number, number] {
  const [y, m] = month.split("-").map(Number);
  return [y!, m!];
}
function monthLabel(month: string): string {
  const [y, m] = parseMonth(month);
  return `${MONTHS[m - 1]} ${y}`;
}
function shiftMonth(month: string, delta: number): string {
  const [y, m] = parseMonth(month);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}
function isoUTC(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
/** 42 calendar dates (6 weeks) starting from the Sunday on/before the 1st — tz-immune. */
function gridDays(month: string): { iso: string; inMonth: boolean }[] {
  const [y, m] = parseMonth(month);
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const start = Date.UTC(y, m - 1, 1) - firstDow * DAY_MS;
  return Array.from({ length: 42 }, (_, i) => {
    const ms = start + i * DAY_MS;
    return { iso: isoUTC(ms), inMonth: new Date(ms).getUTCMonth() === m - 1 };
  });
}
function fmtTime(hhmm: string): string {
  const [h, mm] = hhmm.split(":").map(Number);
  const h12 = h! % 12 === 0 ? 12 : h! % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${h! < 12 ? "AM" : "PM"}`;
}
function fmtDateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return `${WEEKDAYS[dow]}, ${MONTHS_SHORT[m! - 1]} ${d}`;
}
function whenText(e: MergedEvent): string {
  if (e.allDay) return `${fmtDateLong(e.start)} · All day`;
  return `${fmtDateLong(e.start.slice(0, 10))} · ${fmtTime(e.start.slice(11, 16))} – ${fmtTime(e.end.slice(11, 16))}`;
}

/** Source-color: Narthex/Cohort use the palette; iCal carries its own hex. */
function dotClass(e: { kind: MergedEvent["kind"] }): string {
  return e.kind === "narthex" ? "bg-burgundy" : e.kind === "cohort" ? "bg-navy" : "";
}
function dotStyle(e: { kind: MergedEvent["kind"]; color?: string | null }): React.CSSProperties | undefined {
  return e.kind === "ical" ? { backgroundColor: e.color ?? "#3b82f6" } : undefined;
}

export function CalendarClient({
  month,
  events,
  editable,
  sources,
  failedSources,
  canEdit,
}: {
  month: string;
  events: MergedEvent[];
  editable: CalendarEvent[];
  sources: CalendarSource[];
  failedSources: string[];
  canEdit: boolean;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<MergedEvent | null>(null);
  const [editing, setEditing] = useState<{ mode: "create" | "edit"; event?: CalendarEvent; date?: string } | null>(
    null,
  );
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const editableById = useMemo(() => new Map(editable.map((e) => [e.id, e])), [editable]);

  // Filter chips: Narthex/Cohort when present + every enabled feed (so a failed feed keeps
  // its chip). Toggling hides exactly that source.
  const chips = useMemo(() => {
    const out: { label: string; kind: MergedEvent["kind"]; color?: string | null }[] = [];
    if (events.some((e) => e.kind === "narthex")) out.push({ label: NARTHEX_SOURCE_LABEL, kind: "narthex" });
    if (events.some((e) => e.kind === "cohort")) out.push({ label: COHORT_SOURCE_LABEL, kind: "cohort" });
    for (const s of sources) out.push({ label: s.name, kind: "ical", color: s.color });
    return out;
  }, [events, sources]);

  const visible = useMemo(() => events.filter((e) => !hidden.has(e.source)), [events, hidden]);
  const byDay = useMemo(() => {
    const map = new Map<string, MergedEvent[]>();
    for (const e of visible) {
      const key = e.start.slice(0, 10);
      let list = map.get(key);
      if (!list) {
        list = [];
        map.set(key, list);
      }
      list.push(e);
    }
    for (const list of map.values())
      list.sort((a, b) => Number(a.allDay) - Number(b.allDay) || a.start.localeCompare(b.start));
    return map;
  }, [visible]);

  const days = useMemo(() => gridDays(month), [month]);
  const today = new Date().toISOString().slice(0, 10);

  const toggle = (label: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  const openEdit = (e: MergedEvent) => {
    if (!canEdit || !e.dbEventId) return;
    const full = editableById.get(e.dbEventId);
    if (full) setEditing({ mode: "edit", event: full });
  };

  const agenda = useMemo(() => [...visible].sort((a, b) => a.start.localeCompare(b.start)), [visible]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 motion-safe:animate-[po-fade-in_220ms_ease-out]">
      {/* Header + month nav */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Link
            href={`/ocia/calendar?month=${shiftMonth(month, -1)}`}
            aria-label="Previous month"
            className="rounded-md p-2 text-gray-500 hover:bg-parchment hover:text-navy"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h1 className="min-w-[9rem] text-center font-heading text-2xl text-navy" data-testid="calendar-month">
            {monthLabel(month)}
          </h1>
          <Link
            href={`/ocia/calendar?month=${shiftMonth(month, 1)}`}
            aria-label="Next month"
            className="rounded-md p-2 text-gray-500 hover:bg-parchment hover:text-navy"
          >
            <ChevronRight className="h-5 w-5" />
          </Link>
          <Link href="/ocia/calendar" className="ml-1 text-xs font-medium text-burgundy hover:text-rose">
            Today
          </Link>
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditing({ mode: "create", date: today })}
            data-testid="calendar-add-event"
            className="inline-flex items-center gap-1.5 rounded-md bg-gold px-3 py-2 text-sm font-medium text-white hover:bg-gold-dark"
          >
            <Plus className="h-4 w-4" /> Add Event
          </button>
        ) : null}
      </div>

      {/* Failed-feed warnings */}
      {failedSources
        .filter((n) => !dismissed.has(n))
        .map((name) => (
          <div
            key={name}
            className="mb-2 flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          >
            <span>Could not load “{name}”.</span>
            <button type="button" onClick={() => setDismissed((p) => new Set(p).add(name))} aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}

      {/* Source filter chips */}
      {chips.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-2" data-testid="calendar-filters">
          {chips.map((c) => {
            const on = !hidden.has(c.label);
            return (
              <button
                key={c.label}
                type="button"
                onClick={() => toggle(c.label)}
                aria-pressed={on}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                  on ? "border-gray-300 text-navy" : "border-gray-200 text-gray-400 line-through"
                }`}
              >
                <span
                  className={`h-2.5 w-2.5 rounded-full ${on ? dotClass(c) : "bg-gray-300"}`}
                  style={on ? dotStyle(c) : undefined}
                />
                {c.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Month grid (desktop) */}
      <div
        className="hidden overflow-hidden rounded-xl border border-gray-200 bg-white sm:block"
        data-testid="calendar-grid"
      >
        <div className="grid grid-cols-7 border-b border-gray-200 bg-parchment text-center text-xs font-semibold text-gray-500">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-2">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map(({ iso, inMonth }) => {
            const dayEvents = byDay.get(iso) ?? [];
            return (
              <div
                key={iso}
                className={`min-h-24 border-b border-r border-gray-100 p-1.5 ${inMonth ? "" : "bg-gray-50/60"}`}
              >
                <div
                  className={`mb-1 text-right text-xs ${
                    iso === today ? "font-bold text-burgundy" : inMonth ? "text-gray-500" : "text-gray-300"
                  }`}
                >
                  {Number(iso.slice(8, 10))}
                </div>
                <div className="space-y-0.5">
                  {dayEvents.slice(0, 3).map((e) => (
                    <EventChip key={e.key} event={e} onOpen={() => setDetail(e)} onEdit={() => openEdit(e)} />
                  ))}
                  {dayEvents.length > 3 ? (
                    <button
                      type="button"
                      onClick={() => setDetail(dayEvents[3]!)}
                      className="w-full truncate text-left text-[11px] text-gray-400 hover:text-navy"
                    >
                      +{dayEvents.length - 3} more
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Agenda (mobile) */}
      <div className="space-y-4 sm:hidden" data-testid="calendar-agenda">
        {agenda.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
            No events this month.
          </p>
        ) : (
          agenda.map((e) => (
            <button
              key={e.key}
              type="button"
              onClick={() => setDetail(e)}
              className={`flex w-full items-start gap-2 rounded-lg border border-gray-200 bg-white p-3 text-left ${
                e.isGhost ? "opacity-40" : ""
              }`}
            >
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${dotClass(e)}`} style={dotStyle(e)} />
              <span className="min-w-0">
                <span className="block truncate font-medium text-navy">{normalizeSacredText(e.title)}</span>
                <span className="block text-xs text-gray-500">{whenText(e)}</span>
              </span>
            </button>
          ))
        )}
      </div>

      {detail ? (
        <DetailModal
          event={detail}
          canEdit={canEdit}
          onEdit={() => {
            const e = detail;
            setDetail(null);
            openEdit(e);
          }}
          onClose={() => setDetail(null)}
        />
      ) : null}

      {editing ? (
        <CalendarEventModal
          mode={editing.mode}
          event={editing.event}
          defaultDate={editing.date}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </main>
  );
}

function EventChip({ event, onOpen, onEdit }: { event: MergedEvent; onOpen: () => void; onEdit: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      onDoubleClick={onEdit}
      data-testid="calendar-event"
      title={normalizeSacredText(event.title)}
      className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] leading-tight ${
        event.isGhost ? "border border-dashed border-gray-300 opacity-40" : ""
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass(event)}`} style={dotStyle(event)} />
      <span className="truncate text-navy">{normalizeSacredText(event.title)}</span>
    </button>
  );
}

function DetailModal({
  event,
  canEdit,
  onEdit,
  onClose,
}: {
  event: MergedEvent;
  canEdit: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy/30 p-4 backdrop-blur-sm sm:items-center motion-safe:animate-[po-fade-in_160ms_ease-out]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Event detail"
        data-testid="calendar-detail-modal"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl motion-safe:animate-[po-slide-up_220ms_ease-out]"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-heading text-xl text-navy">{normalizeSacredText(event.title)}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-gray-400 hover:text-navy"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-gray-500">
          <span className={`h-2.5 w-2.5 rounded-full ${dotClass(event)}`} style={dotStyle(event)} />
          {event.source}
        </p>
        <dl className="mt-3 space-y-2 text-sm">
          <div>
            <dt className="text-xs font-medium text-gray-400">When</dt>
            <dd className="text-gray-700">{whenText(event)}</dd>
          </div>
          {event.location ? (
            <div>
              <dt className="text-xs font-medium text-gray-400">Where</dt>
              <dd className="text-gray-700">{event.location}</dd>
            </div>
          ) : null}
          {event.description ? (
            <div>
              <dt className="text-xs font-medium text-gray-400">Details</dt>
              <dd className="whitespace-pre-wrap text-gray-700">{event.description}</dd>
            </div>
          ) : null}
        </dl>
        {canEdit && event.dbEventId ? (
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={onEdit}
              data-testid="calendar-detail-edit"
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-parchment"
            >
              Edit
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
