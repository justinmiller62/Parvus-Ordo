"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Trash2, X } from "lucide-react";
import type { CalendarEvent, CalendarEventType } from "@parvaordo/core/calendar-types";
import { createEventAction, deleteEventAction, updateEventAction } from "./actions";

const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';
const FIELD =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";
const LABEL = "block text-xs font-medium text-gray-600";

const TYPE_OPTIONS: { value: CalendarEventType; label: string }[] = [
  { value: "liturgical", label: "Liturgical Feast Day" },
  { value: "obligation", label: "Holy Day of Obligation" },
  { value: "custom", label: "Custom" },
];

export interface CalendarEventModalProps {
  mode: "create" | "edit";
  /** Pre-fills the form when editing an existing event. */
  event?: CalendarEvent;
  /** Default date for a new event (the day the editor clicked, else today). */
  defaultDate?: string;
  onClose: () => void;
}

/** Add / edit a Narthex calendar event. Submit is blocked unless title + date are present;
 *  the "Celebrated on" (observed) date only applies to liturgical / obligation feasts. */
export function CalendarEventModal({ mode, event, defaultDate, onClose }: CalendarEventModalProps) {
  const [title, setTitle] = useState(event?.title ?? "");
  const [eventDate, setEventDate] = useState(event?.eventDate ?? defaultDate ?? "");
  const [eventTime, setEventTime] = useState(event?.eventTime ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [eventType, setEventType] = useState<CalendarEventType>(event?.eventType ?? "custom");
  const [observedDate, setObservedDate] = useState(event?.observedDate ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [annual, setAnnual] = useState(event?.recurrence === "annual");
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

  const canSubmit = title.trim().length > 0 && eventDate.length > 0 && !pending;
  const showObserved = eventType === "liturgical" || eventType === "obligation";

  function save() {
    if (!canSubmit) return;
    const input = {
      title: title.trim(),
      eventDate,
      observedDate: showObserved && observedDate ? observedDate : null,
      eventTime: eventTime.trim() || null,
      location: location.trim() || null,
      eventType,
      description: description.trim() || null,
      recurrence: annual ? "annual" : null,
    };
    startTransition(async () => {
      if (mode === "edit" && event) await updateEventAction(event.id, input);
      else await createEventAction(input);
      close();
    });
  }

  function remove() {
    if (!event || pending) return;
    if (!confirm("Delete this event? This can't be undone.")) return;
    startTransition(async () => {
      await deleteEventAction(event.id);
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
        aria-label={mode === "edit" ? "Edit event" : "Add event"}
        data-testid="calendar-event-modal"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md overflow-auto rounded-2xl bg-white p-6 shadow-xl motion-safe:animate-[po-slide-up_220ms_ease-out]"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-xl text-navy">{mode === "edit" ? "Edit event" : "Add event"}</h2>
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
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              data-testid="event-title"
              className={`mt-1 ${FIELD}`}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>
              Date
              <input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                required
                data-testid="event-date"
                className={`mt-1 ${FIELD}`}
              />
            </label>
            <label className={LABEL}>
              Time <span className="text-gray-400">(optional)</span>
              <input
                value={eventTime}
                onChange={(e) => setEventTime(e.target.value)}
                placeholder="7:00 PM"
                className={`mt-1 ${FIELD}`}
              />
            </label>
          </div>
          <label className={LABEL}>
            Location <span className="text-gray-400">(optional)</span>
            <input value={location} onChange={(e) => setLocation(e.target.value)} className={`mt-1 ${FIELD}`} />
          </label>
          <label className={LABEL}>
            Type
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value as CalendarEventType)}
              className={`mt-1 ${FIELD}`}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {showObserved ? (
            <label className={LABEL}>
              Celebrated on <span className="text-gray-400">(if transferred)</span>
              <input
                type="date"
                value={observedDate}
                onChange={(e) => setObservedDate(e.target.value)}
                data-testid="event-observed"
                className={`mt-1 ${FIELD}`}
              />
            </label>
          ) : null}
          <label className={LABEL}>
            Description <span className="text-gray-400">(optional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={`mt-1 ${FIELD}`}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={annual}
              onChange={(e) => setAnnual(e.target.checked)}
              className="accent-gold"
            />
            Repeats annually
          </label>

          <div className="flex items-center justify-between border-t border-gray-200 pt-4">
            {mode === "edit" ? (
              <button
                type="button"
                onClick={remove}
                disabled={pending}
                data-testid="event-delete"
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
              data-testid="event-save"
              className="rounded-md bg-gold px-5 py-2 text-sm font-medium text-white hover:bg-gold-dark disabled:opacity-50"
            >
              {pending ? "Saving…" : mode === "edit" ? "Save" : "Add event"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
